import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { requireRole } from '@/lib/auth'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

interface DiscoveredGateway {
  user: string
  port: number
  active: boolean
  description: string
}

/**
 * GET /api/gateways/discover
 * Discovers OpenClaw gateways via systemd services and port scanning.
 * Does not require filesystem access to other users' configs.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const discovered: DiscoveredGateway[] = []

  // Parse systemd services for openclaw-gateway instances
  try {
    const output = execFileSync('systemctl', [
      'list-units', '--type=service', '--plain', '--no-legend', '--no-pager',
    ], { encoding: 'utf-8', timeout: 3000 })

    const gwLines = output.split('\n').filter(l => l.includes('openclaw') && l.includes('gateway'))

    for (const line of gwLines) {
      // e.g. "openclaw-gateway@quant.service loaded active running OpenClaw Gateway (quant)"
      const parts = line.trim().split(/\s+/)
      const serviceName = parts[0] || ''
      const state = parts[2] || '' // active/inactive
      const description = parts.slice(4).join(' ') // "OpenClaw Gateway (quant)"

      // Extract user from service name
      let user = ''
      const templateMatch = serviceName.match(/openclaw-gateway@(\w+)\.service/)
      if (templateMatch) {
        user = templateMatch[1]
      } else {
        // Custom service name like "openclaw-leads-gateway.service"
        const customMatch = serviceName.match(/openclaw-(\w+)-gateway\.service/)
        if (customMatch) user = customMatch[1]
      }
      if (!user) continue

      // Find the port by checking what openclaw-gateway processes are listening on
      let port = 0
      try {
        const configPath = `/home/${user}/.openclaw/openclaw.json`
        const raw = readFileSync(configPath, 'utf-8')
        const config = JSON.parse(raw)
        if (typeof config?.gateway?.port === 'number') port = config.gateway.port
      } catch {
        // Can't read config — try to detect from ss output
      }

      // If we couldn't read config, try finding port via ss for the service PID
      if (!port) {
        try {
          const pidOutput = execFileSync('systemctl', [
            'show', serviceName, '--property=ExecMainPID', '--value',
          ], { encoding: 'utf-8', timeout: 2000 }).trim()
          const pid = parseInt(pidOutput, 10)
          if (pid > 0) {
            const ssOutput = execFileSync('ss', ['-ltnp'], {
              encoding: 'utf-8', timeout: 2000,
            })
            const pidPattern = `pid=${pid},`
            for (const ssLine of ssOutput.split('\n')) {
              if (ssLine.includes(pidPattern)) {
                const portMatch = ssLine.match(/:(\d+)\s/)
                if (portMatch) { port = parseInt(portMatch[1], 10); break }
              }
            }
          }
        } catch { /* ignore */ }
      }

      if (!port) continue

      discovered.push({
        user,
        port,
        active: state === 'active',
        description: description.replace(/[()]/g, '').trim(),
      })
    }
  } catch {
    // systemctl not available or failed — fall back silently
  }

  return NextResponse.json({ gateways: discovered })
}
