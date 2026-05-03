import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runOpenClaw } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { archiveOrphanTranscriptsForStateDir } from '@/lib/openclaw-doctor-fix'
import { parseOpenClawDoctorOutput } from '@/lib/openclaw-doctor'

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

// ── Stale-while-revalidate cache for the doctor GET ──────────────────────────
// Each call spawns `openclaw doctor` (~10 s on Windows). The doctor banner
// fetches this on every page mount, so opening multiple tabs / refreshing
// rapidly piles up overlapping spawns and leaks node processes when the 15 s
// timeout hits before they're done.
//
// Doctor results change slowly (config drift, new orphan transcripts, etc.),
// so a few-minute cache is fine: serve cached data immediately, refresh in the
// background when stale, single-flight to never run two doctors at once.
// POST (--fix) invalidates the cache so the user sees fresh status after fix.

const DOCTOR_CACHE_FRESH_MS = 5 * 60 * 1000        // 5 min before considered stale
const DOCTOR_TIMEOUT_MS    = 15_000

interface DoctorCacheEntry {
  payload: unknown
  status: number
  fetchedAt: number
}

let doctorCache: DoctorCacheEntry | null = null
let doctorRefreshInflight: Promise<DoctorCacheEntry> | null = null

function invalidateDoctorCache() {
  doctorCache = null
}

async function fetchDoctorOnce(): Promise<DoctorCacheEntry> {
  if (doctorRefreshInflight) return doctorRefreshInflight
  doctorRefreshInflight = (async () => {
    try {
      try {
        const result = await runOpenClaw(['doctor'], { timeoutMs: DOCTOR_TIMEOUT_MS })
        const payload = parseOpenClawDoctorOutput(
          `${result.stdout}\n${result.stderr}`,
          result.code ?? 0,
          { stateDir: config.openclawStateDir },
        )
        const entry: DoctorCacheEntry = { payload, status: 200, fetchedAt: Date.now() }
        doctorCache = entry
        return entry
      } catch (error) {
        const { detail, code } = getCommandDetail(error)
        if (isMissingOpenClaw(detail)) {
          const entry: DoctorCacheEntry = {
            payload: { error: 'OpenClaw is not installed or not reachable' },
            status: 400,
            fetchedAt: Date.now(),
          }
          doctorCache = entry
          return entry
        }
        const payload = parseOpenClawDoctorOutput(detail, code ?? 1, {
          stateDir: config.openclawStateDir,
        })
        const entry: DoctorCacheEntry = { payload, status: 200, fetchedAt: Date.now() }
        doctorCache = entry
        return entry
      }
    } finally {
      doctorRefreshInflight = null
    }
  })()
  return doctorRefreshInflight
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const now = Date.now()
  if (doctorCache) {
    const age = now - doctorCache.fetchedAt
    if (age >= DOCTOR_CACHE_FRESH_MS && !doctorRefreshInflight) {
      // Stale — refresh in the background without blocking this response.
      fetchDoctorOnce().catch(err =>
        logger.warn({ err }, 'Background openclaw doctor refresh failed'),
      )
    }
    return NextResponse.json(doctorCache.payload, {
      status: doctorCache.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  // Cold cache — block on the first fetch.
  const entry = await fetchDoctorOnce()
  return NextResponse.json(entry.payload, {
    status: entry.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Mutating call — drop the cached snapshot so the GET issued after a fix
  // returns the new (post-fix) state instead of the pre-fix one.
  invalidateDoctorCache()

  try {
    const progress: Array<{ step: string; detail: string }> = []

    const fixResult = await runOpenClaw(['doctor', '--fix'], { timeoutMs: 120000 })
    progress.push({ step: 'doctor', detail: 'Applied OpenClaw doctor config fixes.' })

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

    const postFix = await runOpenClaw(['doctor'], { timeoutMs: 15000 })
    const status = parseOpenClawDoctorOutput(`${postFix.stdout}\n${postFix.stderr}`, postFix.code ?? 0, {
      stateDir: config.openclawStateDir,
    })
    // Seed the cache so the banner's next GET doesn't spawn doctor again.
    doctorCache = { payload: status, status: 200, fetchedAt: Date.now() }

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
      output: `${fixResult.stdout}\n${fixResult.stderr}`.trim(),
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
