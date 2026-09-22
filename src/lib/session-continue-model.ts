import { MODEL_CATALOG } from './models'
import { isEffortLevel, type EffortLevel } from './chat-model-groups'

const MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,79}$/

function safeModelId(id: string): string | undefined {
  return MODEL_ID_RE.test(id) ? id : undefined
}

function lastSegment(name: string): string {
  return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
}

function providerForKind(kind: string): string | undefined {
  if (kind === 'claude-code') return 'anthropic'
  if (kind === 'codex-cli') return 'openai'
  if (kind === 'grok') return 'xai'
  if (kind === 'kimi') return 'moonshot'
  return undefined
}

export function continueModelId(kind: string, modelAlias: string, fast: boolean): string | undefined {
  if (fast && kind === 'claude-code') return 'claude-haiku-4-5'
  const alias = modelAlias.trim()
  if (!alias) return undefined
  const match = MODEL_CATALOG.find((item) => item.alias === alias || item.name === alias || item.name.endsWith(`/${alias}`))
  const expected = providerForKind(kind)
  if (!expected) return undefined
  if (match) {
    if (match.provider !== expected) return undefined
    return safeModelId(lastSegment(match.name))
  }
  if (alias.includes('/') || alias.includes('..') || alias.startsWith('-')) return undefined
  return safeModelId(alias)
}

export function continueEffort(kind: string, effort: string): EffortLevel | undefined {
  if (!isEffortLevel(effort)) return undefined
  if (kind === 'claude-code' || kind === 'grok') return effort
  return undefined
}
