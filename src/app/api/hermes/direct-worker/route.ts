import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { runCommand } from '@/lib/command'
import { logger } from '@/lib/logger'

const DEFAULT_ADAPTER_DIR = '/Users/phfer/hermes-workspaces/citara-tech-brain/mission-control-adapter'
const DEFAULT_DIRECT_CLIENT = `${DEFAULT_ADAPTER_DIR}/hermes_direct_worker_client.py`
const DEFAULT_MINIONS_WORKER = '/Users/phfer/hermes-workspaces/research/minions/server/workers/hermes_worker.py'

function adapterDir(): string {
  return process.env.CITARA_MC_ADAPTER_DIR || DEFAULT_ADAPTER_DIR
}

function directClientPath(): string {
  return process.env.CITARA_HERMES_DIRECT_CLIENT || DEFAULT_DIRECT_CLIENT
}

function directWorkerScript(): string {
  return process.env.CITARA_HERMES_DIRECT_WORKER_SCRIPT || DEFAULT_MINIONS_WORKER
}

/**
 * GET /api/hermes/direct-worker
 * Health/status endpoint for the Minions-inspired Hermes Direct Worker.
 *
 * This does not process Mission Control tasks. It verifies that the JSONL worker
 * can boot and import Hermes AIAgent directly, keeping the feature safe and
 * reversible behind CITARA_HERMES_EXECUTOR=direct / --executor direct.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const client = directClientPath()
  const worker = directWorkerScript()
  const cwd = adapterDir()

  if (!existsSync(client)) {
    return NextResponse.json({ ok: false, error: `Direct client not found: ${client}`, client, worker, cwd }, { status: 500 })
  }
  if (!existsSync(worker)) {
    return NextResponse.json({ ok: false, error: `Minions worker not found: ${worker}`, client, worker, cwd }, { status: 500 })
  }

  try {
    const startedAt = Date.now()
    const result = await runCommand('python3', [client], {
      cwd,
      timeoutMs: 30_000,
      env: {
        ...process.env,
        CITARA_HERMES_DIRECT_WORKER_SCRIPT: worker,
      },
    })
    const elapsedMs = Date.now() - startedAt
    let health: any = null
    try { health = JSON.parse(result.stdout || '{}') } catch { health = null }

    return NextResponse.json({
      ok: result.code === 0,
      code: result.code,
      elapsed_ms: elapsedMs,
      client,
      worker,
      cwd,
      health,
      stdout: (result.stdout || '').slice(0, 4000),
      stderr: (result.stderr || '').slice(0, 4000),
      usage: {
        dry_run: 'python3 controlled_fleet_runner.py --dry-run --json --executor direct',
        real_queue: 'python3 controlled_fleet_runner.py --executor direct --notify-empty',
        env_flag: 'CITARA_HERMES_EXECUTOR=direct',
      },
    }, { status: result.code === 0 ? 200 : 503 })
  } catch (err: any) {
    logger.error({ err }, 'Hermes direct worker health failed')
    return NextResponse.json({
      ok: false,
      error: err?.message || 'Hermes direct worker health failed',
      timed_out: Boolean(err?.timedOut),
      stdout: (err?.stdout || '').slice(0, 4000),
      stderr: (err?.stderr || '').slice(0, 4000),
      client,
      worker,
      cwd,
    }, { status: 500 })
  }
}
