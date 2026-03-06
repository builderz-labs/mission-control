import fs from 'node:fs'
import { config } from '@/lib/config'

interface OpenClawGatewayConfig {
  gateway?: {
    auth?: {
      token?: string
    }
    port?: number
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

export function getDetectedGatewayToken(): string {
  const envToken = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').trim()
  if (envToken) return envToken

  const parsed = readOpenClawConfig()
  const cfgToken = String(parsed?.gateway?.auth?.token || '').trim()
  return cfgToken
}

export function getDetectedGatewayPort(): number | null {
  const envPort = Number(process.env.OPENCLAW_GATEWAY_PORT || process.env.GATEWAY_PORT || '')
  if (Number.isFinite(envPort) && envPort > 0) return envPort

  const parsed = readOpenClawConfig()
  const cfgPort = Number(parsed?.gateway?.port || 0)
  return Number.isFinite(cfgPort) && cfgPort > 0 ? cfgPort : null
}
