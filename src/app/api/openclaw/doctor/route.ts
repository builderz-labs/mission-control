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

// ── Single-flight + TTL cache for ambient GET polling (closes #613) ──
//
// `openclaw doctor` spawns a Node subprocess that allocates ~300-600 MB
// and runs at 37-51 % CPU. The dashboard banner + onboarding modal +
// multiple browser tabs polling /api/openclaw/doctor concurrently could
// produce 6+ simultaneous subprocesses on a 4 GB host (issue #613).
//
// Two layers of mitigation, GET-only (POST/--fix path stays uncoalesced
// because operators clicking "Re-check" want a guaranteed fresh run):
//
//   1. Single-flight: if a doctor invocation is already in flight, share
//      its eventual result with all concurrent callers — never spawn a
//      second subprocess while one is running.
//   2. TTL cache: cache the last successful response for DOCTOR_TTL_MS
//      (30 s default, override via MC_DOCTOR_TTL_MS). Subsequent GETs
//      within the window return the cached payload.
//
// Cache is invalidated by a successful POST /api/openclaw/doctor (--fix)
// so the freshly-fixed state surfaces immediately.

interface CachedDoctor {
  payload: unknown
  status: number
  fetchedAt: number
}

interface DoctorCacheModule {
  cached: CachedDoctor | null
  inFlight: Promise<CachedDoctor> | null
  ttlMs: number
}

// Module-level singleton (lives across requests within one server worker).
const doctorCache: DoctorCacheModule = (() => {
  // Allow operators to tune the TTL (e.g. CI smoke tests set it to 0).
  const fromEnv = Number.parseInt(process.env.MC_DOCTOR_TTL_MS || '', 10)
  const ttlMs = Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 30_000
  return { cached: null, inFlight: null, ttlMs }
})()

/** Internal helper: invalidates the GET cache. Called by POST after --fix. */
export function invalidateDoctorCache(): void {
  doctorCache.cached = null
}

async function runAndCacheDoctor(): Promise<CachedDoctor> {
  try {
    const result = await runOpenClaw(['doctor'], { timeoutMs: 15000 })
    const payload = parseOpenClawDoctorOutput(
      `${result.stdout}\n${result.stderr}`,
      result.code ?? 0,
      { stateDir: config.openclawStateDir },
    )
    const entry: CachedDoctor = { payload, status: 200, fetchedAt: Date.now() }
    doctorCache.cached = entry
    return entry
  } catch (error) {
    const { detail, code } = getCommandDetail(error)
    if (isMissingOpenClaw(detail)) {
      // Don't cache "not installed" — the operator may install OpenClaw and
      // we want the next poll to pick that up immediately rather than waiting
      // out the TTL.
      const entry: CachedDoctor = {
        payload: { error: 'OpenClaw is not installed or not reachable' },
        status: 400,
        fetchedAt: Date.now(),
      }
      return entry
    }
    const payload = parseOpenClawDoctorOutput(detail, code ?? 1, {
      stateDir: config.openclawStateDir,
    })
    // Cache the parsed-error payload (status 200) so a flapping doctor doesn't
    // re-spawn on every poll. The payload itself carries the failure detail.
    const entry: CachedDoctor = { payload, status: 200, fetchedAt: Date.now() }
    doctorCache.cached = entry
    return entry
  }
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // 1) Cache hit — return immediately.
  const cached = doctorCache.cached
  if (cached && Date.now() - cached.fetchedAt < doctorCache.ttlMs) {
    return NextResponse.json(cached.payload, {
      status: cached.status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Doctor-Cache': 'hit',
        'X-Doctor-Age-Ms': String(Date.now() - cached.fetchedAt),
      },
    })
  }

  // 2) Single-flight — attach to an in-progress run if one exists.
  const inFlight = doctorCache.inFlight ?? (doctorCache.inFlight = runAndCacheDoctor()
    .finally(() => { doctorCache.inFlight = null }))

  const sharedResult = await inFlight
  return NextResponse.json(sharedResult.payload, {
    status: sharedResult.status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Doctor-Cache': 'miss',
    },
  })
}

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

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

    // The fix changed state on disk — drop the GET cache so the next poll
    // sees the fresh status immediately rather than waiting out the TTL.
    invalidateDoctorCache()

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
