import { runOpenClaw } from '@/lib/command'
import { logger } from '@/lib/logger'

// Verdad canónica de qué agentes existen: `openclaw agents list --json`.
// El sqlite de MC acumula drift (registros de agentes que ya no viven en el
// gateway); esto permite marcar cuáles son reales sin borrar nada.
// Cacheado en memoria — spawnear el CLI en cada request de /api/agents sería caro.

export interface GatewayAgent {
  id: string
  identityName?: string
  identityEmoji?: string
  model?: string
  isDefault?: boolean
}

let cache: { at: number; agents: GatewayAgent[] } | null = null
const TTL_MS = 30_000

export async function getGatewayAgents(): Promise<GatewayAgent[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.agents
  try {
    const { stdout } = await runOpenClaw(['agents', 'list', '--json'], { timeoutMs: 10_000 })
    const parsed = JSON.parse(stdout)
    const agents: GatewayAgent[] = Array.isArray(parsed) ? parsed : []
    cache = { at: Date.now(), agents }
    return agents
  } catch (err) {
    logger.warn({ err }, 'gateway agents list unavailable; liveness enrichment skipped')
    // No cacheamos el fallo: el gateway puede volver en el siguiente request.
    return []
  }
}

// Un agente sqlite corresponde a uno del gateway si coincide id o identityName
// (case-insensitive) — el sqlite guarda "Helix", el gateway id "main" + identityName "Helix".
export function matchesGatewayAgent(name: string, gw: GatewayAgent[]): GatewayAgent | undefined {
  const n = name.trim().toLowerCase()
  return gw.find(g => g.id.toLowerCase() === n || (g.identityName ?? '').toLowerCase() === n)
}
