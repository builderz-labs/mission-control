import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runOpenClaw } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { archiveOrphanTranscriptsForStateDir } from '@/lib/openclaw-doctor-fix'
import { parseOpenClawDoctorOutput } from '@/lib/openclaw-doctor'

const DOCTOR_CACHE_TTL_MS = 5 * 60_000
const DOCTOR_WARM_TIMEOUT_MS = 2_500
const DOCTOR_COMMAND_TIMEOUT_MS = 20_000
const DOCTOR_PLUGIN_TIMEOUT_MS = 8_000

type DoctorStatus = ReturnType<typeof parseOpenClawDoctorOutput>

let doctorStatusCache:
  | {
      expiresAt: number
      status: DoctorStatus
    }
  | null = null

let doctorRefreshPromise: Promise<DoctorStatus> | null = null

function getCommandDetail(error: unknown): { detail: string; code: number | null } {
  const err = error as {
    stdout?: string
    stderr?: string
    message?: string
    code?: number | null
  }

  return {
    detail: [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n').trim(),
    code: typeof err?.code === 'number' ? err.code : null,
  }
}

function isMissingOpenClaw(detail: string): boolean {
  return /enoent|not installed|not reachable|command not found/i.test(detail)
}

function loadedLocalPluginIds(raw: string): string[] {
  const ids = new Set<string>()
  for (const match of raw.matchAll(/\bglobal:([a-z0-9-]+)\//gi)) {
    if (match[1]) ids.add(match[1])
  }
  for (const match of raw.matchAll(/^\[plugins\]\s+([a-z0-9-]+):\s+loaded without install\/load-path provenance\b/gim)) {
    if (match[1]) ids.add(match[1])
  }
  for (const match of raw.matchAll(/\/\.openclaw\/extensions\/([a-z0-9-]+)\//gi)) {
    if (match[1]) ids.add(match[1])
  }
  const extensionRoot = path.join(process.env.HOME || '', '.openclaw', 'extensions')
  if (extensionRoot && fs.existsSync(extensionRoot)) {
    for (const entry of fs.readdirSync(extensionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (fs.existsSync(path.join(extensionRoot, entry.name, 'index.ts')) || fs.existsSync(path.join(extensionRoot, entry.name, 'index.js'))) {
        ids.add(entry.name)
      }
    }
  }
  return [...ids]
}

function isPluginDoctorInstruction(issue: string): boolean {
  return /run "openclaw doctor --fix" to remove stale plugins\.allow and/i.test(issue) ||
    /remove stale plugins\.allow and plugins\.entries ids/i.test(issue)
}

function sanitizeDoctorStatusForFilesystemReality(
  status: DoctorStatus
) {
  const stateDir = config.openclawStateDir
  if (!stateDir) return status

  const sessionStoreDir = path.join(stateDir, 'agents', 'main', 'sessions')
  const credentialsDir = path.join(stateDir, 'credentials')

  const isSecureStateDir = (() => {
    try {
      return (fs.statSync(stateDir).mode & 0o077) === 0
    } catch {
      return false
    }
  })()

  const hasSessionStoreDir = fs.existsSync(sessionStoreDir)
  const hasCredentialsDir = fs.existsSync(credentialsDir)

  const shouldStripLine = (line: string) =>
    (isSecureStateDir && /state directory permissions are too open|recommend chmod 700/i.test(line)) ||
    (hasSessionStoreDir && /session store dir missing|agents\/main\/sessions/i.test(line)) ||
    (hasCredentialsDir && /oauth dir missing|\/credentials\)/i.test(line))

  const filteredIssues = status.issues.filter((issue) => !shouldStripLine(issue))
  if (filteredIssues.length === status.issues.length) return status

  const filteredRaw = status.raw
    .split(/\r?\n/)
    .filter((line) => !shouldStripLine(line))
    .join('\n')
    .trim()

  const filteredExitCode = /\bcritical:|invalid config|failed|error/i.test(filteredRaw) ? 1 : 0
  return parseOpenClawDoctorOutput(filteredRaw, filteredExitCode, {
    stateDir: config.openclawStateDir,
  })
}

function sanitizeDoctorStatusForLocalPlugins(
  status: DoctorStatus,
  pluginsListRaw: string
) {
  const localLoaded = loadedLocalPluginIds(pluginsListRaw)
  if (localLoaded.length === 0) return status

  const issueMentionsLoadedLocalPlugin = (issue: string) =>
    localLoaded.some((id) =>
      issue.includes(id) && /(plugin not found|stale plugin reference)/i.test(issue)
    )

  const shouldStripLine = (line: string) =>
    issueMentionsLoadedLocalPlugin(line) || isPluginDoctorInstruction(line)

  const filteredIssues = status.issues.filter((issue) => !shouldStripLine(issue))
  if (filteredIssues.length === status.issues.length) return status

  const filteredRaw = status.raw
    .split(/\r?\n/)
    .filter((line) => !shouldStripLine(line))
    .join('\n')
    .trim()

  const filteredExitCode = /\bcritical:|invalid config|failed|error/i.test(filteredRaw) ? 1 : 0
  return parseOpenClawDoctorOutput(filteredRaw, filteredExitCode, {
    stateDir: config.openclawStateDir,
  })
}

function fallbackDoctorStatus(summary = 'OpenClaw doctor scan is warming up.'): DoctorStatus {
  return {
    level: 'warning',
    category: 'general',
    healthy: false,
    summary,
    issues: [],
    canFix: false,
    raw: '',
  }
}

async function computeDoctorStatus(): Promise<DoctorStatus> {
  let raw = ''
  let code = 0

  try {
    const result = await runOpenClaw(['doctor'], { timeoutMs: DOCTOR_COMMAND_TIMEOUT_MS })
    raw = result.code === 0
      ? [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      : `${result.stdout}\n${result.stderr}`
    code = result.code ?? 0
  } catch (error) {
    const detail = getCommandDetail(error)
    raw = detail.detail
    code = detail.code ?? 1
  }

  let status = parseOpenClawDoctorOutput(raw, code, {
    stateDir: config.openclawStateDir,
  })

  if (status.issues.some((issue) => /(plugin not found|stale plugin reference)/i.test(issue))) {
    try {
      const plugins = await runOpenClaw(['plugins', 'list'], { timeoutMs: DOCTOR_PLUGIN_TIMEOUT_MS })
      status = sanitizeDoctorStatusForLocalPlugins(status, `${plugins.stdout}\n${plugins.stderr}`)
    } catch {
      // Ignore plugin list failures; the raw doctor result is still usable.
    }
  }

  status = sanitizeDoctorStatusForFilesystemReality(status)
  doctorStatusCache = {
    expiresAt: Date.now() + DOCTOR_CACHE_TTL_MS,
    status,
  }

  return status
}

async function refreshDoctorStatus(force = false): Promise<DoctorStatus> {
  if (!force && doctorRefreshPromise) {
    return doctorRefreshPromise
  }

  doctorRefreshPromise = computeDoctorStatus()
    .catch((error) => {
      if (doctorStatusCache) return doctorStatusCache.status
      throw error
    })
    .finally(() => {
      doctorRefreshPromise = null
    })

  return doctorRefreshPromise
}

async function getDoctorStatus(options: { force?: boolean } = {}) {
  if (options.force) {
    return refreshDoctorStatus(true)
  }

  if (doctorStatusCache && doctorStatusCache.expiresAt > Date.now()) {
    return doctorStatusCache.status
  }

  if (doctorStatusCache) {
    const staleStatus = doctorStatusCache.status
    const pendingRefresh = refreshDoctorStatus(true)
    return Promise.race<DoctorStatus>([
      pendingRefresh,
      new Promise<DoctorStatus>((resolve) => {
        setTimeout(() => resolve(staleStatus), DOCTOR_WARM_TIMEOUT_MS)
      }),
    ])
  }

  const pendingRefresh = refreshDoctorStatus(true)
  return Promise.race<DoctorStatus>([
    pendingRefresh,
    new Promise<DoctorStatus>((resolve) => {
      setTimeout(() => resolve(fallbackDoctorStatus()), DOCTOR_WARM_TIMEOUT_MS)
    }),
  ])
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const url = new URL(request.url)
    const force = ['1', 'true', 'yes', 'on'].includes(
      String(url.searchParams.get('force') || '').trim().toLowerCase()
    )

    return NextResponse.json(await getDoctorStatus({ force }), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const { detail, code } = getCommandDetail(error)
    if (isMissingOpenClaw(detail)) {
      return NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 })
    }

    return NextResponse.json(parseOpenClawDoctorOutput(detail, code ?? 1, {
      stateDir: config.openclawStateDir,
    }), {
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    doctorStatusCache = null
    const progress: Array<{ step: string; detail: string }> = []

    const preflightStatus = await getDoctorStatus({ force: true })
    let fixOutput = ''

    const shouldRunDoctorFix =
      !preflightStatus.healthy &&
      !(preflightStatus.category === 'state' && preflightStatus.level === 'warning')

    if (shouldRunDoctorFix) {
      const fixResult = await runOpenClaw(['doctor', '--fix'], { timeoutMs: 120000 })
      fixOutput = `${fixResult.stdout}\n${fixResult.stderr}`.trim()
      progress.push({ step: 'doctor', detail: 'Applied OpenClaw doctor config fixes.' })
    }

    try {
      await runOpenClaw(['sessions', 'cleanup', '--all-agents', '--enforce', '--fix-missing'], { timeoutMs: 120000 })
      progress.push({ step: 'sessions', detail: 'Pruned missing transcript entries from session stores.' })
    } catch (error) {
      const { detail } = getCommandDetail(error)
      progress.push({ step: 'sessions', detail: detail || 'Session cleanup skipped.' })
    }

    const orphanFix = archiveOrphanTranscriptsForStateDir(config.openclawStateDir)
    progress.push({
      step: 'orphans',
      detail:
        orphanFix.archivedOrphans > 0
          ? `Archived ${orphanFix.archivedOrphans} orphan transcript file(s) across ${orphanFix.storesScanned} session store(s).`
          : `No orphan transcript files found across ${orphanFix.storesScanned} session store(s).`,
    })

    const status = await getDoctorStatus({ force: true })

    try {
      const db = getDatabase()
      db.prepare(
        'INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)'
      ).run(
        'openclaw.doctor.fix',
        auth.user.username,
        JSON.stringify({ level: status.level, healthy: status.healthy, issues: status.issues })
      )
    } catch {
      // Non-critical.
    }

    return NextResponse.json({
      success: true,
      output: fixOutput,
      progress,
      status,
    })
  } catch (error) {
    const { detail, code } = getCommandDetail(error)
    if (isMissingOpenClaw(detail)) {
      return NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 })
    }

    logger.error({ err: error }, 'OpenClaw doctor fix failed')

    return NextResponse.json(
      {
        error: 'OpenClaw doctor fix failed',
        detail,
        status: parseOpenClawDoctorOutput(detail, code ?? 1, {
          stateDir: config.openclawStateDir,
        }),
      },
      { status: 500 }
    )
  }
}
