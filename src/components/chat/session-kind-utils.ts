const SESSION_KIND_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
  hermes: 'Hermes Agent',
  opencode: 'OpenCode',
  gateway: 'Gateway',
}

export function getSessionKindLabel(kind: string): string {
  return SESSION_KIND_LABELS[kind] ?? SESSION_KIND_LABELS.gateway
}
