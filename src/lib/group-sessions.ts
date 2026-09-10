import { applyFolderOrder } from './chat-folder-order'
import { toActivityMs, workingDirLeaf } from './chat-display'

export type GroupBy = 'folder' | 'project' | 'agent'
export type SortBy = 'activity' | 'name'
export type StatusFilter = 'all' | 'active' | 'inactive'
export type EnvironmentFilter = 'all' | 'local' | 'gateway' | 'desktop'

export interface ChatFilterState {
  status: StatusFilter
  environment: EnvironmentFilter
  groupBy: GroupBy
  sortBy: SortBy
  showEmptyGroups: boolean
  showPrStatus: boolean
  search: string
}

export const DEFAULT_CHAT_FILTERS: ChatFilterState = {
  status: 'all',
  environment: 'all',
  groupBy: 'folder',
  sortBy: 'activity',
  showEmptyGroups: false,
  showPrStatus: true,
  search: '',
}

export interface ChatSessionItem {
  id: string
  name: string
  active: boolean
  updatedAt: number
  workingDir: string | null
  agent: string
  environment: 'local' | 'gateway' | 'desktop'
  project: string
  projectSlug: string
  hasPr: boolean
  kind: string
  tokens?: string
  model?: string
  age?: string
  startTime?: number
}

export interface ChatProjectItem {
  name: string
  slug: string
}

export interface SidebarRow {
  key: string
  label: string
  sessionCount: number
  latestActivity: number
  hasPr: boolean
  hasActive: boolean
}

function matchesSearch(session: ChatSessionItem, search: string): boolean {
  if (!search) return true
  const q = search.toLowerCase()
  return (
    session.name.toLowerCase().includes(q) ||
    session.project.toLowerCase().includes(q) ||
    session.agent.toLowerCase().includes(q) ||
    (session.workingDir || '').toLowerCase().includes(q)
  )
}

export function filterSessions(
  sessions: ChatSessionItem[],
  filters: ChatFilterState,
): ChatSessionItem[] {
  return sessions.filter((session) => {
    if (filters.status === 'active' && !session.active) return false
    if (filters.status === 'inactive' && session.active) return false
    if (filters.environment !== 'all' && session.environment !== filters.environment) return false
    return matchesSearch(session, filters.search.trim())
  })
}

export function groupKey(session: ChatSessionItem, groupBy: GroupBy): { key: string; label: string } {
  if (groupBy === 'agent') {
    const label = session.agent || 'Direct'
    return { key: `agent:${label}`, label }
  }
  const folder = workingDirLeaf(session.workingDir) || session.project || session.projectSlug
  const label = folder || session.project || 'Ungrouped'
  const slug = session.projectSlug || label.toLowerCase()
  return { key: `folder:${slug}`, label }
}

function sortRows(rows: SidebarRow[], sortBy: SortBy): SidebarRow[] {
  return [...rows].sort((a, b) => {
    if (sortBy === 'name') return a.label.localeCompare(b.label)
    const byTime = toActivityMs(b.latestActivity) - toActivityMs(a.latestActivity)
    if (byTime) return byTime
    if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

function orderSidebarRows(rows: SidebarRow[], sortBy: SortBy, folderOrder: string[]): SidebarRow[] {
  const sorted = sortRows(rows, sortBy)
  if (sortBy === 'activity') return sorted
  return applyFolderOrder(sorted, folderOrder)
}

export function buildSidebarRows(
  sessions: ChatSessionItem[],
  projects: ChatProjectItem[],
  filters: ChatFilterState,
  pins: string[],
  folderOrder: string[] = [],
): { pinned: SidebarRow[]; rest: SidebarRow[] } {
  const visible = filterSessions(sessions, filters)
  const byKey = new Map<string, SidebarRow>()

  for (const session of visible) {
    const { key, label } = groupKey(session, filters.groupBy)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        key,
        label,
        sessionCount: 1,
        latestActivity: toActivityMs(session.updatedAt),
        hasPr: session.hasPr,
        hasActive: session.active,
      })
      continue
    }
    existing.sessionCount += 1
    existing.latestActivity = Math.max(existing.latestActivity, toActivityMs(session.updatedAt))
    existing.hasPr = existing.hasPr || session.hasPr
    existing.hasActive = existing.hasActive || session.active
  }

  if (filters.groupBy !== 'agent') {
    for (const project of projects) {
      const key = `folder:${project.slug}`
      if (byKey.has(key)) continue
      byKey.set(key, {
        key,
        label: project.name,
        sessionCount: 0,
        latestActivity: 0,
        hasPr: false,
        hasActive: false,
      })
    }
  }

  const pinSet = new Set(pins)
  const pinned: SidebarRow[] = []
  const rest: SidebarRow[] = []
  for (const row of byKey.values()) {
    const slug = row.key.slice(row.key.indexOf(':') + 1)
    if (pinSet.has(slug) || pinSet.has(row.key)) pinned.push(row)
    else rest.push(row)
  }

  return {
    pinned: orderSidebarRows(pinned, filters.sortBy, folderOrder),
    rest: orderSidebarRows(rest, filters.sortBy, folderOrder),
  }
}
