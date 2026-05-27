import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { runCommand } from '@/lib/command'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

const DEFAULT_SCRIPT = '/Users/phfer/.hermes/scripts/citara_mission_control_fleet_runner.sh'
const DEFAULT_CWD = '/Users/phfer/hermes-workspaces/citara-tech-brain/mission-control-adapter'
const DEFAULT_LOG_PATH = '/Users/phfer/hermes-workspaces/citara-tech-brain/mission-control-adapter/logs/citara-fleet-runner.jsonl'

function fleetRunnerScriptPath(): string {
  return process.env.CITARA_MC_FLEET_RUNNER_SCRIPT || DEFAULT_SCRIPT
}

function fleetRunnerCwd(): string {
  return process.env.CITARA_MC_FLEET_RUNNER_CWD || DEFAULT_CWD
}

function fleetRunnerLogPath(): string {
  return process.env.CITARA_MC_FLEET_RUNNER_LOG || DEFAULT_LOG_PATH
}

function clip(value: string, limit = 8000): string {
  if (!value || value.length <= limit) return value
  return `${value.slice(0, limit - 80).trimEnd()}\n\n[... clipped ${value.length - limit} chars ...]`
}

function readLastRunnerEvent(): Record<string, any> | null {
  try {
    const logPath = fleetRunnerLogPath()
    if (!existsSync(logPath)) return null
    const raw = readFileSync(logPath, 'utf8').trim()
    if (!raw) return null
    const last = raw.split('\n').filter(Boolean).at(-1)
    return last ? JSON.parse(last) : null
  } catch {
    return null
  }
}

/**
 * GET /api/hermes/fleet-runner
 * Operational status for the Cítara Hermes Adapter fleet runner.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const agentRows = db.prepare(`
      SELECT name, status, last_activity, config
      FROM agents
      WHERE workspace_id = ? AND hidden = 0
    `).all(workspaceId) as Array<{ name: string; status: string; last_activity?: string | null; config?: string | null }>

    const hermesAgents = agentRows.filter((agent) => {
      try {
        const cfg = agent.config ? JSON.parse(agent.config) : {}
        return cfg?.runtime === 'hermes' && cfg?.adapter === 'citara-hermes-adapter'
      } catch {
        return false
      }
    })

    const countsRows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM tasks
      WHERE workspace_id = ?
      GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>

    const taskCounts = Object.fromEntries(countsRows.map((row) => [row.status, row.count || 0]))
    const pendingHermesRows = db.prepare(`
      SELECT assigned_to, COUNT(*) as count
      FROM tasks
      WHERE workspace_id = ? AND status = 'awaiting_owner'
      GROUP BY assigned_to
    `).all(workspaceId) as Array<{ assigned_to: string; count: number }>

    return NextResponse.json({
      ok: true,
      script: fleetRunnerScriptPath(),
      cwd: fleetRunnerCwd(),
      log_path: fleetRunnerLogPath(),
      agents: {
        total: agentRows.length,
        hermes_adapter: hermesAgents.length,
        idle_or_ready: hermesAgents.filter((a) => a.status === 'idle' || a.status === 'offline').length,
      },
      tasks: {
        counts: taskCounts,
        awaiting_owner: taskCounts.awaiting_owner || 0,
        quality_review: taskCounts.quality_review || 0,
        failed: taskCounts.failed || 0,
        pending_by_agent: pendingHermesRows,
      },
      last_runner_event: readLastRunnerEvent(),
    })
  } catch (err: any) {
    logger.error({ err }, 'Cítara Hermes fleet runner status failed')
    return NextResponse.json({ ok: false, error: err?.message || 'Fleet runner status failed' }, { status: 500 })
  }
}

/**
 * POST /api/hermes/fleet-runner
 * Manual trigger for the Cítara Hermes Adapter fleet runner.
 *
 * This does not use Mission Control's native OpenClaw/Claude scheduler. It runs
 * the same controlled script used by Hermes Cron, which consumes only
 * `awaiting_owner` tasks and returns them to `quality_review`/`failed`.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const script = fleetRunnerScriptPath()
  const cwd = fleetRunnerCwd()

  if (!existsSync(script)) {
    return NextResponse.json({ success: false, error: `Fleet runner script not found: ${script}` }, { status: 500 })
  }

  try {
    let body: any = {}
    try { body = await request.json() } catch { body = {} }

    const notifyEmpty = body?.notify_empty !== false
    const args = notifyEmpty ? ['--notify-empty'] : []
    const startedAt = Date.now()
    const result = await runCommand(script, args, {
      cwd,
      timeoutMs: 240_000,
      env: {
        ...process.env,
        CITARA_MC_MANUAL_TRIGGER: '1',
      },
    })
    const elapsedMs = Date.now() - startedAt

    logger.info({ actor: auth.user.username, elapsedMs }, 'Cítara Hermes fleet runner manual trigger completed')
    return NextResponse.json({
      success: true,
      code: result.code,
      elapsed_ms: elapsedMs,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr),
      script,
      cwd,
    })
  } catch (err: any) {
    logger.error({ err, actor: auth.user.username }, 'Cítara Hermes fleet runner manual trigger failed')
    return NextResponse.json({
      success: false,
      error: err?.message || 'Fleet runner failed',
      code: err?.code ?? null,
      timed_out: Boolean(err?.timedOut),
      stdout: clip(err?.stdout || ''),
      stderr: clip(err?.stderr || ''),
      script,
      cwd,
    }, { status: 500 })
  }
}
