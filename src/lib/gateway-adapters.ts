export type GatewayAdapterKind = 'openclaw' | 'stub' | 'custom'

export interface GatewayAdapterConfig {
  /** Unique adapter id (used in UI + routing) */
  name: string
  /** Adapter protocol implementation */
  kind: GatewayAdapterKind
  /** WebSocket URL used by the browser */
  wsUrl: string
  /** Optional health check endpoint (http/https) */
  healthUrl?: string
  /** Optional static auth token for adapter auth */
  token?: string
  /** Marks preferred adapter when multiple are configured */
  primary?: boolean
  /** Free-form metadata for docs/UI */
  meta?: Record<string, string>
}

const DEFAULT_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || '18789')
const DEFAULT_HOST = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1'
const DEFAULT_PROTOCOL = process.env.OPENCLAW_GATEWAY_PROTOCOL || 'ws'

function defaultAdapter(): GatewayAdapterConfig {
  const wsUrl = `${DEFAULT_PROTOCOL}://${DEFAULT_HOST}:${DEFAULT_PORT}`
  return {
    name: String(process.env.MC_DEFAULT_GATEWAY_NAME || 'primary'),
    kind: 'openclaw',
    wsUrl,
    healthUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}/`,
    token: process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '',
    primary: true,
  }
}

function normalizeKind(input: unknown): GatewayAdapterKind {
  const raw = String(input || 'openclaw').toLowerCase()
  if (raw === 'openclaw' || raw === 'stub' || raw === 'custom') return raw
  return 'custom'
}

function normalizeAdapter(raw: any, index: number): GatewayAdapterConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || `adapter-${index + 1}`).trim()
  const wsUrl = String(raw.wsUrl || raw.url || '').trim()
  if (!name || !wsUrl) return null
  return {
    name,
    kind: normalizeKind(raw.kind),
    wsUrl,
    healthUrl: raw.healthUrl ? String(raw.healthUrl) : undefined,
    token: raw.token ? String(raw.token) : '',
    primary: Boolean(raw.primary),
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : undefined,
  }
}

/**
 * Parse MC_GATEWAY_ADAPTERS from JSON.
 *
 * Format:
 * MC_GATEWAY_ADAPTERS='[{"name":"primary","kind":"openclaw","wsUrl":"ws://127.0.0.1:18789","healthUrl":"http://127.0.0.1:18789/","primary":true}]'
 */
export function getGatewayAdaptersFromEnv(): GatewayAdapterConfig[] {
  const raw = process.env.MC_GATEWAY_ADAPTERS
  if (!raw) return [defaultAdapter()]

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [defaultAdapter()]
    const normalized = parsed
      .map((entry, index) => normalizeAdapter(entry, index))
      .filter((entry): entry is GatewayAdapterConfig => Boolean(entry))

    if (normalized.length === 0) return [defaultAdapter()]
    if (!normalized.some(a => a.primary)) {
      normalized[0].primary = true
    }
    return normalized
  } catch {
    return [defaultAdapter()]
  }
}

export function getGatewayAdapterByName(name?: string): GatewayAdapterConfig {
  const adapters = getGatewayAdaptersFromEnv()
  if (!name) return adapters.find(a => a.primary) || adapters[0]
  return adapters.find(a => a.name === name) || adapters.find(a => a.primary) || adapters[0]
}
