import type { Project } from '@/store'
import type { JevSetupMessage, JevSetupRevision } from '@/lib/jev-setup-session-types'
import type { JevAssistantResponse } from './jev-ui-types'

export function idsForScope(scope: string | undefined, projects: Project[], activeId: number | null, selected: number[]): number[] {
  if (scope === 'all') return projects.filter((project) => project.status === 'active').map((project) => project.id)
  if (scope === 'selected') return selected
  return activeId ? [activeId] : []
}

export function latestStoredInput(messages: JevSetupMessage[]): { goal?: string; answers?: Record<string, string>; projectIds?: number[] } {
  for (const message of [...messages].reverse()) if (message.role === 'user') {
    try { return JSON.parse(message.content) } catch { return {} }
  }
  return {}
}

export function revisionResponse(revision: JevSetupRevision): JevAssistantResponse {
  const kind = revision.provider === 'anthropic' || revision.provider === 'openai' ? revision.provider : 'claude-cli'
  return {
    draft: revision.draft as JevAssistantResponse['draft'],
    configuration: revision.configuration as JevAssistantResponse['configuration'],
    provider: { kind, model: revision.model }, warnings: [],
    session: { id: revision.session_id, revisionNo: revision.revision_no },
  }
}
