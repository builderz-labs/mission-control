import { NextRequest, NextResponse } from 'next/server'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { isHermesInstalled, isHermesGatewayRunning, scanHermesSessions } from '@/lib/hermes-sessions'
import { getHermesTasks } from '@/lib/hermes-tasks'
import { getHermesMemory } from '@/lib/hermes-memory'
import { logger } from '@/lib/logger'

const HERMES_HOME = join(config.homeDir, '.hermes')
const HOOK_DIR = join(HERMES_HOME, 'hooks', 'mission-control')

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const installed = isHermesInstalled()
    const gatewayRunning = installed ? isHermesGatewayRunning() : false
    const hookInstalled = existsSync(join(HOOK_DIR, 'HOOK.yaml'))
    const activeSessions = installed ? scanHermesSessions(50).filter(s => s.isActive).length : 0

    const cronJobCount = installed ? getHermesTasks().cronJobs.length : 0
    const memoryEntries = installed ? getHermesMemory().agentMemoryEntries : 0

    return NextResponse.json({
      installed,
      gatewayRunning,
      hookInstalled,
      activeSessions,
      cronJobCount,
      memoryEntries,
      hookDir: HOOK_DIR,
    })
  } catch (err) {
    logger.error({ err }, 'Hermes status check failed')
    return NextResponse.json({ error: 'Failed to check hermes status' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'install-hook') {
      if (!isHermesInstalled()) {
        return NextResponse.json({ error: 'Hermes is not installed (~/.hermes/ not found)' }, { status: 400 })
      }

      mkdirSync(HOOK_DIR, { recursive: true })

      // Write HOOK.yaml
      writeFileSync(join(HOOK_DIR, 'HOOK.yaml'), HOOK_YAML, 'utf8')

      // Write handler.py
      writeFileSync(join(HOOK_DIR, 'handler.py'), HANDLER_PY, 'utf8')

      logger.info('Installed Mission Control hook for Hermes Agent')
      return NextResponse.json({ success: true, message: 'Hook installed', hookDir: HOOK_DIR })
    }

    if (action === 'uninstall-hook') {
      if (existsSync(HOOK_DIR)) {
        rmSync(HOOK_DIR, { recursive: true, force: true })
      }

      logger.info('Uninstalled Mission Control hook for Hermes Agent')
      return NextResponse.json({ success: true, message: 'Hook uninstalled' })
    }

    return NextResponse.json({ error: 'Invalid action. Must be: install-hook, uninstall-hook' }, { status: 400 })
  } catch (err: any) {
    logger.error({ err }, 'Hermes hook management failed')
    return NextResponse.json({ error: err.message || 'Hook operation failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Hook file contents
// ---------------------------------------------------------------------------

const HOOK_YAML = `name: mission-control
description: Reports agent telemetry to Mission Control
version: "1.0"
events:
  - agent:start
  - agent:end
  - session:start
`

const HANDLER_PY = `"""
Mission Control hook for Hermes Agent.
Reports session telemetry to the MC /api/sessions endpoint.

Configuration (via ~/.hermes/.env or environment):
  MC_URL      - Mission Control base URL (default: http://localhost:3000)
  MC_API_KEY  - API key for authentication (optional)
"""

import os
import logging
from datetime import datetime, timezone

logger = logging.getLogger("hooks.mission-control")

MC_URL = os.environ.get("MC_URL", "http://localhost:3000")
MC_API_KEY = os.environ.get("MC_API_KEY", "")


def _headers():
    h = {"Content-Type": "application/json"}
    if MC_API_KEY:
        h["X-Api-Key"] = MC_API_KEY
    return h


async def handle_event(event_name: str, payload: dict) -> None:
    """
    Called by the Hermes hook registry on matching events.
    Fire-and-forget with a short timeout — never blocks the agent.
    """
    try:
        import httpx
    except ImportError:
        logger.debug("httpx not available, skipping MC telemetry")
        return

    try:
        if event_name == "agent:start":
            await _report_agent_start(payload)
        elif event_name == "agent:end":
            await _report_agent_end(payload)
        elif event_name == "session:start":
            await _report_session_start(payload)
    except Exception as exc:
        logger.debug("MC hook error (%s): %s", event_name, exc)


async def _report_agent_start(payload: dict) -> None:
    import httpx

    data = {
        "name": payload.get("agent_name", "hermes"),
        "role": "Hermes Agent",
        "status": "active",
        "source": "hermes-hook",
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/agents", json=data, headers=_headers())


async def _report_agent_end(payload: dict) -> None:
    import httpx

    data = {
        "name": payload.get("agent_name", "hermes"),
        "status": "idle",
        "source": "hermes-hook",
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/agents", json=data, headers=_headers())


async def _report_session_start(payload: dict) -> None:
    import httpx

    data = {
        "event": "session:start",
        "session_id": payload.get("session_id", ""),
        "source": payload.get("source", "cli"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/hermes/events", json=data, headers=_headers())
`

export const dynamic = 'force-dynamic'
