import fs from 'node:fs'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

interface OpenClawGatewayConfig {
  gateway?: {
    auth?: {
      mode?: 'token' | 'password'
      token?: string
      password?: string
    }
    port?: number
    /** Bind address (e.g. "loopback", "127.0.0.1", or host) — Hermes gateway.json */
    bind?: string
    controlUi?: {
      allowedOrigins?: string[]
    }
  }
}

function readGatewayConfig(): OpenClawGatewayConfig | null {
  const configPath = config.gatewayConfigPath || config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) return null
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(raw) as OpenClawGatewayConfig
  } catch {
    return null
  }
}

export function registerMcAsDashboard(mcUrl: string): { registered: boolean; alreadySet: boolean } {
  const configPath = config.gatewayConfigPath || config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) {
    return { registered: false, alreadySet: false }
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, any>

    // Ensure nested structure
    if (!parsed.gateway) parsed.gateway = {}
    if (!parsed.gateway.controlUi) parsed.gateway.controlUi = {}

    const origin = new URL(mcUrl).origin
    const origins: string[] = parsed.gateway.controlUi.allowedOrigins || []
    const alreadyInOrigins = origins.includes(origin)

    if (alreadyInOrigins) {
      return { registered: false, alreadySet: true }
    }

    // Add MC origin to allowedOrigins only — do NOT touch dangerouslyDisableDeviceAuth.
    // MC authenticates via gateway token, but forcing device auth off is a security
    // downgrade that the operator should control, not Mission Control.
    origins.push(origin)
    parsed.gateway.controlUi.allowedOrigins = origins

    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n')
    logger.info({ origin }, 'Registered MC origin in gateway config')
    return { registered: true, alreadySet: false }
  } catch (err: any) {
    // Read-only filesystem (e.g. Docker read_only: true, or intentional mount) —
    // treat as a non-fatal skip rather than an error.
    if (err?.code === 'EROFS' || err?.code === 'EACCES' || err?.code === 'EPERM') {
      logger.warn(
        { err, configPath },
        'Gateway config is read-only — skipping MC origin registration. ' +
        'To enable auto-registration, mount gateway config with write access or ' +
        'add the MC origin to gateway.controlUi.allowedOrigins manually.',
      )
      return { registered: false, alreadySet: false }
    }
    logger.error({ err }, 'Failed to register MC in gateway config')
    return { registered: false, alreadySet: false }
  }
}

/**
 * Returns the Hermes API server key (API_SERVER_KEY) when set.
 * Used for Bearer auth to the OpenAI-compatible API at port 8642 (GET /health, /v1/models).
 */
export function getHermesApiServerKey(): string {
  return (process.env.API_SERVER_KEY || process.env.HERMES_API_SERVER_KEY || '').trim()
}

/**
 * Returns the gateway auth credential (token or password) for Bearer/WS auth.
 * Env: API_SERVER_KEY, HERMES_API_SERVER_KEY (Hermes API server), then HERMES_GATEWAY_TOKEN, OPENCLAW_GATEWAY_TOKEN, GATEWAY_TOKEN, then password variants.
 * From config: uses gateway.auth.token when mode is "token", gateway.auth.password when mode is "password".
 */
export function getDetectedGatewayToken(): string {
  const apiKey = getHermesApiServerKey()
  if (apiKey) return apiKey

  const envToken = (process.env.HERMES_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').trim()
  if (envToken) return envToken

  const envPassword = (process.env.HERMES_GATEWAY_PASSWORD || process.env.OPENCLAW_GATEWAY_PASSWORD || process.env.GATEWAY_PASSWORD || '').trim()
  if (envPassword) return envPassword

  const parsed = readGatewayConfig()
  const auth = parsed?.gateway?.auth
  const mode = auth?.mode === 'password' ? 'password' : 'token'
  const credential =
    mode === 'password'
      ? String(auth?.password ?? '').trim()
      : String(auth?.token ?? '').trim()
  return credential
}

/**
 * Base URL for the Hermes OpenAI-compatible API server (e.g. http://127.0.0.1:8642).
 * Used for GET /health and /v1/* when API_SERVER_ENABLED or HERMES_API_SERVER_PORT is set.
 */
export function getHermesApiServerBaseUrl(): string {
  return `http://${config.hermesApiServerHost}:${config.hermesApiServerPort}`
}

/**
 * Returns the health check URL and whether to use the Hermes API server.
 * When HERMES_HOME or HERMES_API_SERVER_PORT is set, use GET /health on the API server port (8642).
 * Otherwise use the control gateway at /api/health on gatewayPort (18789).
 */
export function getGatewayHealthProbe(): { url: string; useApiServer: boolean } {
  const useApiServer =
    config.hermesHome != null ||
    (Number(process.env.HERMES_API_SERVER_PORT || '0') > 0)
  if (useApiServer) {
    return { url: `${getHermesApiServerBaseUrl()}/health`, useApiServer: true }
  }
  const host = getDetectedGatewayHost()
  const port = getDetectedGatewayPort() ?? config.gatewayPort
  return { url: `http://${host}:${port}/api/health`, useApiServer: false }
}

export function getDetectedGatewayPort(): number | null {
  const envPort = Number(process.env.HERMES_GATEWAY_PORT || process.env.OPENCLAW_GATEWAY_PORT || process.env.GATEWAY_PORT || '')
  if (Number.isFinite(envPort) && envPort > 0) return envPort

  const parsed = readGatewayConfig()
  const cfgPort = Number(parsed?.gateway?.port || 0)
  return Number.isFinite(cfgPort) && cfgPort > 0 ? cfgPort : null
}

/** Host to probe for gateway (from gateway.json bind or env). Default 127.0.0.1. */
export function getDetectedGatewayHost(): string {
  const envHost = (process.env.HERMES_GATEWAY_HOST || process.env.OPENCLAW_GATEWAY_HOST || process.env.GATEWAY_HOST || '').trim()
  if (envHost) return envHost

  const parsed = readGatewayConfig()
  const bind = String(parsed?.gateway?.bind ?? '').trim().toLowerCase()
  if (bind === 'loopback' || bind === '127.0.0.1') return '127.0.0.1'
  if (bind) return bind

  return config.gatewayHost || '127.0.0.1'
}
