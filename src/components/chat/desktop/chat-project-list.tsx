'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ChatFilterState, SidebarRow } from '@/lib/group-sessions'
import { ChatFilterPopover } from './chat-filter-popover'
import { ChatProjectFolder } from './chat-project-folder'
import type { GitLensSessionRow } from './chat-session-row'
import { IconChevron, IconSearch, IconSliders } from './chat-icons'
import { applyFolderOrder, useFolderDnd, type FolderDragProps } from './use-folder-dnd'

export function ChatProjectList({
  pinned,
  rest,
  selectedKey,
  filters,
  onFiltersChange,
  onSelect,
  onNewInGroup,
  onSearch,
  sessionsByProject,
  activeSessionId,
  onSelectSession,
  pins,
  onTogglePin,
  folderOrder = [],
  onReorder,
  now,
}: {
  pinned: SidebarRow[]
  rest: SidebarRow[]
  selectedKey: string | null
  filters: ChatFilterState
  onFiltersChange: (next: ChatFilterState) => void
  onSelect: (row: SidebarRow) => void
  onNewInGroup: (row: SidebarRow) => void
  onSearch: (value: string) => void
  sessionsByProject: Record<string, GitLensSessionRow[]>
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  pins: string[]
  onTogglePin: (slug: string) => void
  folderOrder?: string[]
  onReorder?: (next: string[]) => void
  now?: number
}) {
  const t = useTranslations('chatDesktop')
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const orderedPinned = filters.sortBy === 'activity' ? pinned : applyFolderOrder(pinned, folderOrder)
  const orderedRest = filters.sortBy === 'activity' ? rest : applyFolderOrder(rest, folderOrder)
  const keys = [...orderedPinned, ...orderedRest].map((row) => row.key)
  const dnd = useFolderDnd({ keys, onReorder: onReorder ?? (() => undefined), listRef })
  const folderShared = {
    showPr: filters.showPrStatus,
    sessionsByProject,
    activeSessionId,
    selectedKey,
    pins,
    now,
    dragging: dnd.dragging,
    onSelect,
    onNewInGroup,
    onTogglePin,
    onSelectSession,
    folderProps: dnd.folderProps,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pt-3">
      <div className="flex items-center gap-1 px-1">
        <span className="flex-1 text-[13px] text-[var(--chat-muted)]">{t('projects')}</span>
        <button type="button" className="cursor-pointer rounded p-1 text-[var(--chat-muted)] hover:bg-white/5" onClick={() => onNewInGroup(rest[0] || pinned[0])} aria-label={t('navNew')} disabled={!rest.length && !pinned.length}>
          <span className="text-sm leading-none">+</span>
        </button>
        <button type="button" className="cursor-pointer rounded p-1 text-[var(--chat-muted)] hover:bg-white/5" onClick={() => setSearchOpen((open) => !open)} aria-label={t('searchProjects')}>
          <IconSearch />
        </button>
        <div className="relative">
          <button
            type="button"
            className="cursor-pointer rounded p-1 text-[var(--chat-muted)] hover:bg-white/5"
            onClick={() => setFilterOpen((open) => !open)}
            aria-label={t('filterProjects')}
            aria-expanded={filterOpen}
          >
            <IconSliders />
          </button>
          {filterOpen && <ChatFilterPopover value={filters} onChange={onFiltersChange} onClose={() => setFilterOpen(false)} />}
        </div>
      </div>
      {searchOpen && (
        <input
          value={filters.search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t('searchProjects')}
          className="mt-2 h-8 rounded-md border border-[var(--chat-border)] bg-black/30 px-2 text-[13px] text-[var(--chat-text)] placeholder:text-[var(--chat-muted)]"
        />
      )}
      <div ref={listRef} className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {orderedPinned.length > 0 && (
          <Section label={t('pinned')} rows={orderedPinned} {...folderShared} />
        )}
        <Section rows={orderedRest} {...folderShared} />
      </div>
    </div>
  )
}

function Section({
  label,
  rows,
  selectedKey,
  showPr,
  sessionsByProject,
  activeSessionId,
  pins,
  now,
  dragging,
  onSelect,
  onNewInGroup,
  onTogglePin,
  onSelectSession,
  folderProps,
}: {
  label?: string
  rows: SidebarRow[]
  selectedKey: string | null
  showPr: boolean
  sessionsByProject: Record<string, GitLensSessionRow[]>
  activeSessionId: string | null
  pins: string[]
  now?: number
  dragging: string | null
  onSelect: (row: SidebarRow) => void
  onNewInGroup: (row: SidebarRow) => void
  onTogglePin: (slug: string) => void
  onSelectSession: (id: string) => void
  folderProps: (key: string) => FolderDragProps
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-2">
      {label && (
        <button type="button" className="flex h-7 w-full cursor-pointer items-center gap-1 px-2 text-[13px] text-[var(--chat-muted)]" onClick={() => setOpen((value) => !value)}>
          {label}
          <IconChevron className={`h-3 w-3 ${open ? 'rotate-90' : ''}`} />
        </button>
      )}
      {open && rows.map((row) => {
        const slug = row.key.slice(row.key.indexOf(':') + 1)
        return (
          <ChatProjectFolder
            key={row.key}
            row={row}
            selected={row.key === selectedKey}
            showPr={showPr}
            sessions={sessionsByProject[row.key] || []}
            activeSessionId={activeSessionId}
            pinned={pins.includes(slug)}
            dragging={dragging === row.key}
            now={now}
            onSelect={onSelect}
            onNewInGroup={onNewInGroup}
            onTogglePin={onTogglePin}
            onSelectSession={onSelectSession}
            folderProps={folderProps(row.key)}
          />
        )
      })}
    </div>
  )
}
