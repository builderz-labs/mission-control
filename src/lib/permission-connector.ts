export type UnifiedPermissionMode = 'ask' | 'auto' | 'accept_edits' | 'plan' | 'bypass'

export type PermissionRuntime =
  | 'claude-code'
  | 'codex-cli'
  | 'opencode'
  | 'grok'
  | 'kimi'
  | 'gateway'

const MODES = new Set<UnifiedPermissionMode>(['ask', 'auto', 'accept_edits', 'plan', 'bypass'])

const ALIASES: Record<string, UnifiedPermissionMode> = {
  default: 'ask',
  manual: 'ask',
  ask: 'ask',
  auto: 'auto',
  accept_edits: 'accept_edits',
  acceptedits: 'accept_edits',
  plan: 'plan',
  bypass: 'bypass',
  bypasspermissions: 'bypass',
  'always-approve': 'bypass',
  yolo: 'auto',
}

const ARGV: Record<PermissionRuntime, Record<UnifiedPermissionMode, string[]>> = {
  'claude-code': {
    ask: ['--permission-mode', 'manual'],
    auto: ['--permission-mode', 'auto'],
    accept_edits: ['--permission-mode', 'acceptEdits'],
    plan: ['--permission-mode', 'plan'],
    bypass: ['--permission-mode', 'bypassPermissions'],
  },
  'codex-cli': {
    ask: [],
    auto: ['--approve-for-me'],
    accept_edits: ['--approve-for-me', '--sandbox', 'workspace-write'],
    plan: [],
    bypass: ['--sandbox', 'danger-full-access'],
  },
  grok: {
    ask: ['--permission-mode', 'default'],
    auto: ['--permission-mode', 'auto'],
    accept_edits: ['--permission-mode', 'acceptEdits'],
    plan: ['--permission-mode', 'plan'],
    bypass: ['--always-approve'],
  },
  kimi: {
    ask: [],
    auto: ['--yolo'],
    accept_edits: ['--yolo'],
    plan: [],
    bypass: ['--auto'],
  },
  opencode: { ask: [], auto: [], accept_edits: [], plan: [], bypass: [] },
  gateway: { ask: [], auto: [], accept_edits: [], plan: [], bypass: [] },
}

export function isBypassMode(mode: unknown): mode is 'bypass' {
  return mode === 'bypass'
}

export function parsePermissionMode(value: unknown): UnifiedPermissionMode {
  if (typeof value !== 'string') return 'ask'
  return ALIASES[value.trim().toLowerCase()] ?? 'ask'
}

export function isPermissionRuntime(value: string): value is PermissionRuntime {
  return value in ARGV
}

export function permissionSupport(kind: string): 'full' | 'overlay' | 'none' {
  if (kind === 'opencode') return 'none'
  if (kind === 'gateway') return 'overlay'
  return isPermissionRuntime(kind) ? 'full' : 'none'
}

export function permissionArgv(kind: string, mode: UnifiedPermissionMode): string[] {
  if (!isPermissionRuntime(kind)) return []
  return [...ARGV[kind][mode]]
}

export function isUnifiedPermissionMode(value: unknown): value is UnifiedPermissionMode {
  return typeof value === 'string' && MODES.has(value as UnifiedPermissionMode)
}
