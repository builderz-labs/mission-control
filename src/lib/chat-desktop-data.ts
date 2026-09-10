import type { Conversation } from '@/store'
import type { ChatPullRequest } from './github-pulls'
import type { ChatSessionItem, SidebarRow } from './group-sessions'
import { toActivityMs } from './chat-display'
import { isPlaceholderSessionTitle, isTreeKind, projectSlugOf, sessionTitle, sessionsForProject } from './chat-session-identity'
import type { TreeKind } from './chat-session-identity'
import type { TranscriptMessage } from './session-transcript-types'

export interface GitLensSessionRow {
  id: string
  kind: TreeKind
  title: string
  updatedAt: number
  active?: boolean
  tokens?: string
  model?: string
  age?: string
  startTime?: number
}

export interface HomeSessionRow {
  id: string
  title: string
  subtitle: string
  repo: string
  updatedAt: number
  active: boolean
  hasPr: boolean
}

export function conversationsToItems(
  conversations: Conversation[],
  pulls: ChatPullRequest[],
): ChatSessionItem[] {
  return sortNewestFirst(
    conversations
      .filter((conv) => conv.source === 'session')
      .map((conv) => toSessionItem(conv, pulls))
      .filter((item) => item.active || !isPlaceholderSessionTitle(item.name)),
  )
}

export function gitLensByProject(
  items: ChatSessionItem[],
  rows: { pinned: SidebarRow[]; rest: SidebarRow[] },
): Record<string, GitLensSessionRow[]> {
  const map: Record<string, GitLensSessionRow[]> = {}
  for (const row of [...rows.pinned, ...rows.rest]) {
    map[row.key] = sortNewestFirst(
      sessionsForProject(items, row.key)
        .filter((item): item is ChatSessionItem & { kind: TreeKind } => isTreeKind(item.kind))
        .filter((item) => item.active || !isPlaceholderSessionTitle(item.name))
        .map(toGitLensRow),
    )
  }
  return map
}

export function toHomeSessions(items: ChatSessionItem[]): HomeSessionRow[] {
  return sortNewestFirst(
    items.filter((item) => isTreeKind(item.kind) && (item.active || !isPlaceholderSessionTitle(item.name))),
  ).slice(0, 8).map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: item.agent,
    repo: item.project,
    updatedAt: item.updatedAt,
    active: item.active,
    hasPr: item.hasPr,
  }))
}

function toSessionItem(conv: Conversation, pulls: ChatPullRequest[]): ChatSessionItem {
  const kind = conv.session?.sessionKind || conv.kind || 'gateway'
  const leaf = projectSlugOf(conv.session?.workingDir)
  return {
    id: conv.id,
    name: sessionTitle({
      customTitle: conv.session?.customTitle,
      lastUserPrompt: conv.session?.lastUserPrompt,
      prefName: conv.session?.displayName || conv.name,
      kind,
      id: conv.id,
    }),
    active: !!conv.session?.active,
    updatedAt: Math.max(toActivityMs(conv.session?.lastActivity), toActivityMs(conv.updatedAt)),
    workingDir: conv.session?.workingDir || null,
    agent: isTreeKind(kind) ? kind : (conv.session?.agent || ''),
    environment: conv.session?.sessionKind === 'gateway' ? 'gateway' : 'local',
    project: leaf,
    projectSlug: leaf,
    hasPr: pulls.some((pr) => leaf && pr.repo.toLowerCase().includes(leaf)),
    kind,
    tokens: conv.session?.tokens,
    model: conv.session?.model,
    age: conv.session?.age,
    startTime: conv.session?.startTime,
  }
}

function toGitLensRow(item: ChatSessionItem & { kind: TreeKind }): GitLensSessionRow {
  return {
    id: item.id,
    kind: item.kind,
    title: item.name,
    updatedAt: item.updatedAt,
    active: item.active,
    tokens: item.tokens,
    model: item.model,
    age: item.age,
    startTime: item.startTime,
  }
}

function sortNewestFirst<T extends { updatedAt: number; id: string; active?: boolean }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byTime = toActivityMs(b.updatedAt) - toActivityMs(a.updatedAt)
    if (byTime) return byTime
    if (Boolean(a.active) !== Boolean(b.active)) return a.active ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}

export function withOptimisticUser(messages: TranscriptMessage[], pending: string | null): TranscriptMessage[] {
  if (!pending) return messages
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const text = lastUser?.parts.find((part) => part.type === 'text')
  if (text && text.type === 'text' && text.text === pending) return messages
  return [...messages, { role: 'user', parts: [{ type: 'text', text: pending }] }]
}
