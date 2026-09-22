import fs from 'node:fs'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { acquireFileLockSync, atomicReplaceFileSync } from '@/lib/atomic-file'
import { cachedGatewayToken, isUsableGatewayToken, resolveGatewayCredential } from '@/lib/gateway-token'

export { isUsableGatewayToken } from '@/lib/gateway-token'

export function dashboardOriginAliases(mcUrl: string): string[] {
  const parsed = new URL(mcUrl)
  const hosts = new Set([parsed.hostname])
  if (parsed.hostname === 'localhost') hosts.add('127.0.0.1')
  if (parsed.hostname === '127.0.0.1') hosts.add('localhost')
  return [...hosts].map((hostname) => {
    const alias = new URL(parsed.href)
    alias.hostname = hostname
    return alias.origin
  })
}

interface OpenClawGatewayConfig {
  gateway?: {
    auth?: {
      mode?: 'token' | 'password'
      token?: string
      password?: string
    }
    port?: number
    controlUi?: {
      allowedOrigins?: string[]
    }
  }
}

function readOpenClawConfig(): OpenClawGatewayConfig | null {
  const configPath = config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) return null
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(raw) as OpenClawGatewayConfig
  } catch {
    return null
  }
}

export function registerMcAsDashboard(mcUrl: string): { registered: boolean; alreadySet: boolean } {
  const configPath = config.openclawConfigPath
  if (!configPath) {
    return { registered: false, alreadySet: false }
  }

  let releaseLock: (() => void) | undefined
  try {
    releaseLock = acquireFileLockSync(configPath)
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, any>

    // Ensure nested structure
    if (!parsed.gateway) parsed.gateway = {}
    if (!parsed.gateway.controlUi) parsed.gateway.controlUi = {}

    const aliases = dashboardOriginAliases(mcUrl)
    const origins: string[] = parsed.gateway.controlUi.allowedOrigins || []
    const missing = aliases.filter((origin) => !origins.includes(origin))

    if (missing.length === 0) {
      return { registered: false, alreadySet: true }
    }

    // Add MC origin aliases only — do NOT touch dangerouslyDisableDeviceAuth.
    origins.push(...missing)
    parsed.gateway.controlUi.allowedOrigins = origins

    atomicReplaceFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n')
    logger.info({ origins: missing }, 'Registered MC origin in gateway config')
    return { registered: true, alreadySet: false }
  } catch (err: any) {
    // Read-only filesystem (e.g. Docker read_only: true, or intentional mount) —
    // treat as a non-fatal skip rather than an error.
    if (err?.code === 'EROFS' || err?.code === 'EACCES' || err?.code === 'EPERM') {
      logger.warn(
        { err, configPath },
        'Gateway config is read-only — skipping MC origin registration. ' +
        'To enable auto-registration, mount openclaw.json with write access or ' +
        'add the MC origin to gateway.controlUi.allowedOrigins manually.',
      )
      return { registered: false, alreadySet: false }
    }
    logger.error({ err }, 'Failed to register MC in gateway config')
    return { registered: false, alreadySet: false }
  } finally {
    releaseLock?.()
  }
}

/**
 * Returns the gateway auth credential (token or password) for Bearer/WS auth.
 * Env overrides: OPENCLAW_GATEWAY_TOKEN, GATEWAY_TOKEN, OPENCLAW_GATEWAY_PASSWORD, GATEWAY_PASSWORD.
 * From config: uses gateway.auth.token when mode is "token", gateway.auth.password when mode is "password".
 */
export function getDetectedGatewayToken(): string {
  return cachedGatewayToken(() => {
    const envToken = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').trim()
    if (isUsableGatewayToken(envToken)) return envToken

    const envPassword = (process.env.OPENCLAW_GATEWAY_PASSWORD || process.env.GATEWAY_PASSWORD || '').trim()
    if (isUsableGatewayToken(envPassword)) return envPassword

    const parsed = readOpenClawConfig()
    const auth = parsed?.gateway?.auth
    const mode = auth?.mode === 'password' ? 'password' : 'token'
    const credential = resolveGatewayCredential(
      mode === 'password' ? auth?.password : auth?.token,
    )
    if (credential) {
      logger.debug('Gateway token loaded from OpenClaw secret ref')
    }
    return credential
  })
}

export function getDetectedGatewayPort(): number | null {
  const envPort = Number(process.env.OPENCLAW_GATEWAY_PORT || process.env.GATEWAY_PORT || '')
  if (Number.isFinite(envPort) && envPort > 0) return envPort

  const parsed = readOpenClawConfig()
  const cfgPort = Number(parsed?.gateway?.port || 0)
  if (Number.isFinite(cfgPort) && cfgPort > 0) {
    logger.debug({ port: cfgPort }, 'Gateway port loaded from openclaw.json (set OPENCLAW_GATEWAY_PORT env var to override)')
    return cfgPort
  }
  return null
}
