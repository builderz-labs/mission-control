'use client'

import type { ChatFilterState, SidebarRow } from '@/lib/group-sessions'
import { ChatNav } from './chat-nav'
import { ChatProjectList } from './chat-project-list'
import type { GitLensSessionRow } from './chat-session-row'
import { ChatUserFooter } from './chat-user-footer'

export function ChatSidebar({
  pinned,
  rest,
  selectedKey,
  filters,
  onFiltersChange,
  onSelect,
  onNew,
  onNewInGroup,
  onSearch,
  onNavigate,
  onCustomize,
  sessionsByProject,
  activeSessionId,
  onSelectSession,
  pins,
  onTogglePin,
  folderOrder,
  onReorder,
  now,
}: {
  pinned: SidebarRow[]
  rest: SidebarRow[]
  selectedKey: string | null
  filters: ChatFilterState
  onFiltersChange: (next: ChatFilterState) => void
  onSelect: (row: SidebarRow) => void
  onNew: () => void
  onNewInGroup: (row: SidebarRow) => void
  onSearch: (value: string) => void
  onNavigate: (panel: string) => void
  onCustomize: () => void
  sessionsByProject: Record<string, GitLensSessionRow[]>
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  pins: string[]
  onTogglePin: (slug: string) => void
  folderOrder?: string[]
  onReorder?: (next: string[]) => void
  now?: number
}) {
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-[var(--chat-border)] bg-[var(--chat-sidebar)]">
      <ChatNav onNew={onNew} onNavigate={onNavigate} onCustomize={onCustomize} />
      <ChatProjectList
        pinned={pinned}
        rest={rest}
        selectedKey={selectedKey}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onSelect={onSelect}
        onNewInGroup={onNewInGroup}
        onSearch={onSearch}
        sessionsByProject={sessionsByProject}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
        pins={pins}
        onTogglePin={onTogglePin}
        folderOrder={folderOrder}
        onReorder={onReorder}
        now={now}
      />
      <ChatUserFooter />
    </aside>
  )
}

export type { GitLensSessionRow }
