type AliasMap = Record<string, string>

const DEFAULT_ALIAS_MAP: AliasMap = {
  main: 'nova',
}

const DEFAULT_LABELS: Record<string, string> = {
  nova: 'Nova',
  conductor: 'Conductor',
}

function normalizeId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

function parseAliasMap(): AliasMap {
  const raw = process.env.MC_AGENT_ALIASES || process.env.MISSION_CONTROL_AGENT_ALIASES
  if (!raw) return { ...DEFAULT_ALIAS_MAP }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_ALIAS_MAP }

    const normalized: AliasMap = { ...DEFAULT_ALIAS_MAP }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k || typeof v !== 'string') continue
      normalized[normalizeId(k)] = normalizeId(v)
    }
    return normalized
  } catch {
    return { ...DEFAULT_ALIAS_MAP }
  }
}

export function getAgentAliasMap(): AliasMap {
  return parseAliasMap()
}

export function applyAgentAlias(agentId: string): string {
  const normalized = normalizeId(agentId)
  if (!normalized) return normalized
  const aliases = parseAliasMap()
  return aliases[normalized] || normalized
}

export function getAgentDisplayName(agentIdOrName: string): string {
  const aliased = applyAgentAlias(agentIdOrName)
  const explicit = DEFAULT_LABELS[aliased]
  if (explicit) return explicit
  if (!aliased) return ''
  return aliased
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Convert runtime OpenClaw session key to MC logical key with aliases applied.
 * agent:main:proj:foo -> agent:nova:proj:foo
 */
export function aliasSessionKey(key: string): string {
  const m = String(key || '').match(/^agent:([^:]+):(.*)$/)
  if (!m) return key
  const logical = applyAgentAlias(m[1])
  return `agent:${logical}:${m[2]}`
}

/** Reverse mapping for direct runtime delivery when needed. */
export function unaliasAgentForRuntime(agentId: string): string {
  const target = normalizeId(agentId)
  const aliases = parseAliasMap()
  const reverse = Object.entries(aliases).find(([, mapped]) => mapped === target)
  return reverse?.[0] || target
}

export function getNovaFrontDoorId(): string {
  return applyAgentAlias('main')
}

export function getNovaFrontDoorName(): string {
  return getAgentDisplayName(getNovaFrontDoorId())
}
