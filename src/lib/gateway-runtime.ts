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
    const deviceAuthAlreadyDisabled = parsed.gateway.controlUi.dangerouslyDisableDeviceAuth === true

    if (alreadyInOrigins && deviceAuthAlreadyDisabled) {
      return { registered: false, alreadySet: true }
    }

    // Add MC origin to allowedOrigins and disable device auth
    // (MC authenticates via gateway token — device pairing is unnecessary)
    if (!alreadyInOrigins) {
      origins.push(origin)
      parsed.gateway.controlUi.allowedOrigins = origins
    }
    parsed.gateway.controlUi.dangerouslyDisableDeviceAuth = true

    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n')
    logger.info({ origin }, 'Registered MC origin in gateway config')
    return { registered: true, alreadySet: false }
  } catch (err) {
    logger.error({ err }, 'Failed to register MC in gateway config')
    return { registered: false, alreadySet: false }
  }
}

/**
 * Returns the gateway auth credential (token or password) for Bearer/WS auth.
 * Env overrides: OPENCLAW_GATEWAY_TOKEN, GATEWAY_TOKEN, OPENCLAW_GATEWAY_PASSWORD, GATEWAY_PASSWORD.
 * From config: uses gateway.auth.token when mode is "token", gateway.auth.password when mode is "password".
 */
export function getDetectedGatewayToken(): string {
  const envToken = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').trim()
  if (envToken) return envToken
  
  const envPassword = (process.env.OPENCLAW_GATEWAY_PASSWORD || process.env.GATEWAY_PASSWORD || '').trim()
  if (envPassword) return envPassword

  const parsed = readOpenClawConfig()
  const auth = parsed?.gateway?.auth
  const mode = auth?.mode === 'password' ? 'password' : 'token'
  const credential =
    mode === 'password'
      ? String(auth?.password ?? '').trim()
      : String(auth?.token ?? '').trim()
  return credential
}

export function getDetectedGatewayPort(): number | null {
  const envPort = Number(process.env.OPENCLAW_GATEWAY_PORT || process.env.GATEWAY_PORT || '')
  if (Number.isFinite(envPort) && envPort > 0) return envPort

  const parsed = readOpenClawConfig()
  const cfgPort = Number(parsed?.gateway?.port || 0)
  return Number.isFinite(cfgPort) && cfgPort > 0 ? cfgPort : null
}
