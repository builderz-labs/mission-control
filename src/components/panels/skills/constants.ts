export const SOURCE_LABELS: Record<string, string> = {
  'user-agents': '~/.agents/skills (global)',
  'user-codex': '~/.codex/skills (global)',
  'project-agents': '.agents/skills (project)',
  'project-codex': '.codex/skills (project)',
  'openclaw': '~/.openclaw/skills (gateway)',
  'workspace': '~/.openclaw/workspace/skills',
}

export function getSourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source]
  if (source.startsWith('workspace-')) {
    const agentName = source.replace('workspace-', '')
    return `${agentName} workspace`
  }
  return source
}
