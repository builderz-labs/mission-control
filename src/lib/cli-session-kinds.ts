export const CLI_SESSION_SCAN_LIMIT = 400

export const CLI_SESSION_KINDS = [
  'claude-code',
  'codex-cli',
  'grok',
  'kimi',
  'hermes',
  'opencode',
] as const

export type CliSessionKind = (typeof CLI_SESSION_KINDS)[number]

export interface CliKindMeta {
  kind: CliSessionKind | 'gateway'
  label: string
  color: string
  sparkColor: string
}

export const CLI_KIND_META: Record<CliSessionKind | 'gateway', CliKindMeta> = {
  'claude-code': { kind: 'claude-code', label: 'Claude', color: 'text-blue-400', sparkColor: '#60a5fa' },
  'codex-cli': { kind: 'codex-cli', label: 'Codex', color: 'text-green-400', sparkColor: '#4ade80' },
  grok: { kind: 'grok', label: 'Grok', color: 'text-orange-400', sparkColor: '#fb923c' },
  kimi: { kind: 'kimi', label: 'Kimi', color: 'text-violet-400', sparkColor: '#a78bfa' },
  hermes: { kind: 'hermes', label: 'Hermes', color: 'text-cyan-400', sparkColor: '#22d3ee' },
  opencode: { kind: 'opencode', label: 'OpenCode', color: 'text-fuchsia-400', sparkColor: '#e879f9' },
  gateway: { kind: 'gateway', label: 'Gateway', color: 'text-emerald-400', sparkColor: '#34d399' },
}

export function isCliSessionKind(kind: string | undefined): kind is CliSessionKind {
  return CLI_SESSION_KINDS.some((value) => value === kind)
}

export function normalizeCliKind(kind: string | undefined): CliSessionKind | 'gateway' {
  if (isCliSessionKind(kind)) return kind
  return 'gateway'
}

export function cliKindMeta(kind: string | undefined): CliKindMeta {
  return CLI_KIND_META[normalizeCliKind(kind)]
}

export function cliKindLabel(kind: string | undefined): string {
  return cliKindMeta(kind).label
}

const FOREIGN_CLI_PREFIX = /^(grok|kimi|codex|hermes|opencode):/

export function isForeignPrefixedSessionId(sessionId: string): boolean {
  return FOREIGN_CLI_PREFIX.test(sessionId)
}
