'use client'

import type { Agent, Conversation } from '@/store'
import type { SidebarRow } from '@/lib/group-sessions'
import { sessionsForProject } from '@/lib/chat-session-identity'
import type { UnifiedPermissionMode } from '@/lib/permission-connector'

type SessionOpts = {
  model: string
  fast: boolean
  effort: string
  permissionMode: UnifiedPermissionMode
}

export function sendDesktopPrompt(input: {
  text: string
  selected?: Conversation
  selectedKey: string | null
  items: Array<{ id: string; projectSlug: string; kind: string }>
  conversations: Conversation[]
  agents: Agent[]
  opts: SessionOpts
  setPendingUser: (text: string) => void
  setActiveConversation: (id: string | null) => void
  sendSession: (text: string, session: NonNullable<Conversation['session']>, opts: SessionOpts) => Promise<unknown>
  sendAgent: (text: string, id: string) => Promise<unknown>
}) {
  const { text, selected, selectedKey, items, conversations, agents, opts } = input
  if (selected?.session) {
    input.setPendingUser(text)
    void input.sendSession(text, selected.session, opts)
    return
  }
  const latest = selectedKey ? sessionsForProject(items, selectedKey)[0] : undefined
  const latestConv = latest && conversations.find((conv) => conv.id === latest.id)
  if (latestConv?.session) {
    input.setActiveConversation(latestConv.id)
    input.setPendingUser(text)
    void input.sendSession(text, latestConv.session, opts)
    return
  }
  const agent = agents[0]
  if (!agent) return
  const id = `agent_${agent.name}`
  input.setActiveConversation(id)
  void input.sendAgent(text, id)
}

export function projectFromRow<T extends { slug: string; name: string }>(
  projects: T[],
  row: SidebarRow,
): T | null {
  const slug = row.key.slice(row.key.indexOf(':') + 1)
  return projects.find((project) => project.slug === slug || project.name === row.label) || null
}
