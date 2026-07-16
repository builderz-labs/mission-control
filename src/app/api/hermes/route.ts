import { NextRequest, NextResponse } from 'next/server'
import { chmodSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { isHermesInstalled, isHermesGatewayRunning, scanHermesSessions } from '@/lib/hermes-sessions'
import { getHermesTasks } from '@/lib/hermes-tasks'
import { getHermesMemory } from '@/lib/hermes-memory'
import { logger } from '@/lib/logger'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { logAuditEvent } from '@/lib/db'
import { extractClientIp, hermesMutationLimiter } from '@/lib/rate-limit'
import { validateBody } from '@/lib/validation'
import { formatHermesCommandOutput, hermesMutationSchema, parseHermesSetupCommand } from '@/lib/hermes-route-security'

// In Docker, HOME=/nonexistent — check dataDir first, then homeDir
import { resolve } from 'node:path'
const dataDir = resolve(config.dataDir || '.data')
const homeDir = config.homeDir || ''
const HERMES_HOME = existsSync(join(dataDir, '.hermes'))
  ? join(dataDir, '.hermes')
  : existsSync(join(homeDir, '.hermes'))
    ? join(homeDir, '.hermes')
    : join(dataDir, '.hermes') // default to dataDir for new installs
const HOOK_DIR = join(HERMES_HOME, 'hooks', 'mission-control')

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(
    auth.user,
    'runtime_configuration',
    new URL(request.url).pathname,
  )
  if (isolationDeny) return isolationDeny

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
    })
  } catch (err) {
    logger.error({ err }, 'Hermes status check failed')
    return NextResponse.json({ error: 'Failed to check hermes status' }, { status: 500 })
  }
}

function extractDeviceAuth(output: string): { cleanOutput: string; deviceUrl: string | null; userCode: string | null } {
  const cleanOutput = formatHermesCommandOutput(output).replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const deviceUrl = cleanOutput.match(/https?:\/\/[^\s)]+/i)?.[0] || null
  const userCode =
    cleanOutput.match(/(?:code|user code|device code)\s*[:=]\s*([A-Z0-9-]{4,})/i)?.[1]
    || cleanOutput.match(/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+\b/)?.[0]
    || null
  return { cleanOutput, deviceUrl, userCode }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(
    auth.user,
    'runtime_configuration',
    new URL(request.url).pathname,
  )
  if (isolationDeny) return isolationDeny

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}`
  const rateCheck = hermesMutationLimiter(limitKey)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, hermesMutationSchema)
  if ('error' in result) return result.error
  const body = result.data
  const ipAddress = extractClientIp(request)
  const audit = (action: string, detail?: Record<string, unknown>) => logAuditEvent({
    action: `hermes.${action}`,
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail,
    ip_address: ipAddress,
  })

  try {
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

      audit('hook_installed')
      logger.info('Installed Mission Control hook for Hermes Agent')
      return NextResponse.json({ success: true, message: 'Hook installed' })
    }

    if (action === 'uninstall-hook') {
      if (existsSync(HOOK_DIR)) {
        rmSync(HOOK_DIR, { recursive: true, force: true })
      }

      audit('hook_uninstalled')
      logger.info('Uninstalled Mission Control hook for Hermes Agent')
      return NextResponse.json({ success: true, message: 'Hook uninstalled' })
    }

    if (action === 'set-env') {
      const { key, value } = body

      const envPath = join(HERMES_HOME, '.env')
      mkdirSync(HERMES_HOME, { recursive: true, mode: 0o700 })
      let envContent = ''
      try { envContent = require('node:fs').readFileSync(envPath, 'utf8') } catch { /* new file */ }

      // Replace existing key or append
      const regex = new RegExp(`^${key}=.*$`, 'm')
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`)
      } else {
        envContent = envContent.trimEnd() + `\n${key}=${value}\n`
      }

      writeFileSync(envPath, envContent, { encoding: 'utf8', mode: 0o600 })
      chmodSync(envPath, 0o600)
      audit('environment_updated', { key })
      logger.info({ key }, 'Hermes env var set via setup wizard')
      return NextResponse.json({ success: true })
    }

    if (action === 'set-soul') {
      const { content } = body
      if (typeof content !== 'string') {
        return NextResponse.json({ error: 'content is required' }, { status: 400 })
      }

      const soulPath = join(HERMES_HOME, 'SOUL.md')
      mkdirSync(HERMES_HOME, { recursive: true, mode: 0o700 })
      writeFileSync(soulPath, content, { encoding: 'utf8', mode: 0o600 })
      chmodSync(soulPath, 0o600)
      audit('identity_updated', { bytes: Buffer.byteLength(content, 'utf8') })
      logger.info('Hermes SOUL.md updated via setup wizard')
      return NextResponse.json({ success: true })
    }

    if (action === 'run-oauth-model') {
      const { model, provider, authMethod } = body
      const hermesBin = join(HERMES_HOME, 'hermes-agent', 'venv', 'bin', 'hermes')
      const bin = existsSync(hermesBin) ? hermesBin : 'hermes'
      const HOME_DIR = existsSync(join(dataDir, '.hermes')) ? dataDir : homeDir
      const baseEnv = {
        ...process.env,
        HOME: HOME_DIR,
        PATH: `${join(dataDir, '.local', 'bin')}:${process.env.PATH || ''}`,
      }

      try {
        const { runCommand } = require('@/lib/command')

        const requestedProvider = typeof provider === 'string' && provider.trim() ? provider.trim() : 'openai-codex'
        const providerForOAuth = requestedProvider === 'openai' ? 'openai-codex' : requestedProvider
        const requestedAuthMethod = typeof authMethod === 'string' ? authMethod.trim().toLowerCase() : 'device_code'
        if (requestedAuthMethod !== 'device_code') {
          return NextResponse.json({ success: false, error: `Unsupported OAuth auth method: ${requestedAuthMethod}` }, { status: 400 })
        }

        // Ensure provider/model are preselected before invoking device-code auth.
        await runCommand(bin, ['config', 'set', 'model.provider', providerForOAuth], {
          timeoutMs: 15_000,
          env: {
            ...baseEnv,
            HERMES_NONINTERACTIVE: '1',
            CI: '1',
          },
        })

        if (typeof model === 'string' && model.trim()) {
          await runCommand(bin, ['config', 'set', 'model.default', model.trim()], {
            timeoutMs: 15_000,
            env: {
              ...baseEnv,
              HERMES_NONINTERACTIVE: '1',
              CI: '1',
            },
          })
        }

        // Run OAuth/device-code flow inside a PTY so interactive prompts/device codes are emitted.
        const nodePty = await import('node-pty')
        const ptySpawn = nodePty.spawn || (nodePty as any).default?.spawn
        if (!ptySpawn) throw new Error('node-pty spawn unavailable')

        const oauthResult: { code: number; output: string } = await new Promise((resolve) => {
          let output = ''
          let done = false

          const pty = ptySpawn(bin, ['model'], {
            name: 'xterm-256color',
            cols: 120,
            rows: 30,
            cwd: HOME_DIR || process.cwd(),
            env: {
              ...baseEnv,
              TERM: 'xterm-256color',
            } as Record<string, string>,
          })

          const autoInputDelays = [250, 900, 1800]
          autoInputDelays.forEach((delayMs) => {
            setTimeout(() => {
              if (done) return
              try { pty.write('\r') } catch { /* ignore */ }
            }, delayMs)
          })

          const timeout = setTimeout(() => {
            if (done) return
            done = true
            try { pty.kill() } catch { /* ignore */ }
            resolve({ code: 124, output: output.trim() })
          }, 300_000)

          pty.onData((data: string) => {
            output += data
            if (output.length > 50_000) output = output.slice(-50_000)
          })

          pty.onExit(({ exitCode }: { exitCode: number }) => {
            if (done) return
            done = true
            clearTimeout(timeout)
            resolve({ code: exitCode ?? 1, output: output.trim() })
          })
        })

        const parsed = extractDeviceAuth(oauthResult.output)
        const success = oauthResult.code === 0
        audit('oauth_model_completed', { provider: providerForOAuth, success })

        return NextResponse.json({
          success,
          output: parsed.cleanOutput || (success ? 'Authentication complete.' : ''),
          code: oauthResult.code,
          deviceUrl: parsed.deviceUrl,
          userCode: parsed.userCode,
        })
      } catch (err: any) {
        const parsed = extractDeviceAuth((err?.stdout || '') + '\n' + (err?.stderr || ''))
        return NextResponse.json({
          success: false,
          error: 'OAuth command failed',
          output: parsed.cleanOutput,
          deviceUrl: parsed.deviceUrl,
          userCode: parsed.userCode,
        })
      }
    }

    if (action === 'run-command') {
      const { command } = body
      const args = parseHermesSetupCommand(command)
      if (!args) {
        return NextResponse.json({ error: 'Command is not allowed during runtime setup' }, { status: 400 })
      }

      const hermesBin = join(HERMES_HOME, 'hermes-agent', 'venv', 'bin', 'hermes')
      const bin = existsSync(hermesBin) ? hermesBin : 'hermes'

      // Add --non-interactive flags for commands that might prompt
      const env = {
        ...process.env,
        HOME: existsSync(join(dataDir, '.hermes')) ? dataDir : homeDir,
        HERMES_NONINTERACTIVE: '1',
        CI: '1',
        PATH: `${join(dataDir, '.local', 'bin')}:${process.env.PATH || ''}`,
      }

      try {
        const { runCommand } = require('@/lib/command')
        const result = await runCommand(bin, args, {
          timeoutMs: 30_000,
          env,
        })
        audit('setup_command_completed', { command: args.join(' '), success: result.code === 0 })
        return NextResponse.json({
          success: result.code === 0,
          output: formatHermesCommandOutput(result.stdout, result.stderr),
          code: result.code,
        })
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: 'Command failed',
          output: formatHermesCommandOutput(err?.stdout, err?.stderr),
        })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    logger.error({ err }, 'Hermes hook management failed')
    return NextResponse.json({ error: 'Hook operation failed' }, { status: 500 })
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


async def handle(event_name: str, payload: dict) -> None:
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
