import { workingDirLeaf } from './chat-display'

export const TREE_KINDS = ['claude-code', 'codex-cli', 'grok', 'kimi'] as const
export type TreeKind = (typeof TREE_KINDS)[number]

export const ENGINE_LOGOS: Record<TreeKind, string> = {
  'claude-code': '/brand/claude-logo.png',
  'codex-cli': '/brand/codex-logo.png',
  grok: '/brand/grok-logo.png',
  kimi: '/brand/kimi-logo.png',
}

export const ENGINE_LABELS: Record<TreeKind, string> = {
  'claude-code': 'Claude',
  'codex-cli': 'Codex',
  grok: 'Grok',
  kimi: 'Kimi',
}

export function isTreeKind(kind: string | undefined): kind is TreeKind {
  return kind === 'claude-code' || kind === 'codex-cli' || kind === 'grok' || kind === 'kimi'
}

export function inferTreeKind(kind: string | undefined, model: string | undefined): TreeKind | null {
  if (isTreeKind(kind)) return kind
  const hay = `${kind || ''} ${model || ''}`.toLowerCase()
  if (hay.includes('kimi') || hay.includes('moonshot')) return 'kimi'
  if (hay.includes('grok') || hay.includes('xai')) return 'grok'
  if (hay.includes('codex')) return 'codex-cli'
  if (hay.includes('claude')) return 'claude-code'
  return null
}

export function sessionTitle(input: {
  customTitle?: string | null
  lastUserPrompt?: string | null
  prefName?: string | null
  kind: string
  id: string
}): string {
  const custom = cleanTitle(input.customTitle)
  if (custom) return clipTitle(custom)
  const prompt = cleanTitle(input.lastUserPrompt)
  if (prompt) return clipTitle(prompt)
  const pref = cleanTitle(input.prefName)
  if (pref && !looksLikeEngineIdTitle(pref)) return pref
  const kind = isTreeKind(input.kind) ? ENGINE_LABELS[input.kind] : input.kind
  const shortId = input.id.replace(/^.*:/, '').replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return `${kind} · ${shortId}`
}

export function looksLikeNoisePrompt(value: string): boolean {
  const text = value.trim()
  return /^(<(task-notification|system-reminder|notification|task-type|user_action|recommended_plugins|local-command)\b|cd\s+\S+\s+&&)/i.test(text)
}

export function looksLikeEngineIdTitle(value: string): boolean {
  return /^(Claude|Codex|Grok|Kimi)(?:\s+| · )[a-z0-9._:-]+$/i.test(value.trim())
}

export function isPlaceholderSessionTitle(value: string): boolean {
  return looksLikeEngineIdTitle(value)
}

function cleanTitle(value?: string | null): string | null {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text || looksLikeNoisePrompt(text) || looksLikeSlugTitle(text)) return null
  return text
}

function clipTitle(value: string): string {
  return value.length > 72 ? `${value.slice(0, 71)}…` : value
}

export function looksLikeSlugTitle(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (/^[\w.-]+ • [\w.-]+$/.test(normalized)) {
    const [left, right] = normalized.split(' • ')
    return left === right
  }
  return /^[a-z0-9][a-z0-9._-]*$/.test(normalized)
}

export function projectSlugOf(workingDir: string | null | undefined, fallback = ''): string {
  return (workingDirLeaf(workingDir) || fallback).toLowerCase()
}

export function sessionsForProject<T extends { projectSlug: string; kind: string }>(
  sessions: T[],
  projectKey: string,
): T[] {
  const slug = projectKey.includes(':') ? projectKey.slice(projectKey.indexOf(':') + 1) : projectKey
  return sessions.filter((session) => session.projectSlug === slug && isTreeKind(session.kind))
}
