'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ChatFilterState, EnvironmentFilter, GroupBy, SortBy, StatusFilter } from '@/lib/group-sessions'
import { IconCheck, IconChevron } from './chat-icons'

const MENU_CLASS =
  'flex h-8 w-full items-center justify-between px-3 text-[13px] text-[var(--chat-text)] hover:bg-white/5'

type OpenMenu = 'status' | 'environment' | 'groupBy' | 'sortBy' | null

export function ChatFilterPopover({
  value,
  onChange,
  onClose,
}: {
  value: ChatFilterState
  onChange: (next: ChatFilterState) => void
  onClose: () => void
}) {
  const t = useTranslations('chatDesktop')
  const ref = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-0 top-8 z-30 w-[220px] rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] py-1 shadow-2xl"
    >
      <ChoiceRow
        label={t('filterStatus')}
        value={t(`status.${value.status}`)}
        open={openMenu === 'status'}
        onToggle={() => setOpenMenu(openMenu === 'status' ? null : 'status')}
      >
        {(['all', 'active', 'inactive'] as StatusFilter[]).map((status) => (
          <Option
            key={status}
            label={t(`status.${status}`)}
            selected={value.status === status}
            onSelect={() => onChange({ ...value, status })}
          />
        ))}
      </ChoiceRow>
      <ChoiceRow
        label={t('filterEnvironment')}
        value={t(`environment.${value.environment}`)}
        open={openMenu === 'environment'}
        onToggle={() => setOpenMenu(openMenu === 'environment' ? null : 'environment')}
      >
        {(['all', 'local', 'gateway', 'desktop'] as EnvironmentFilter[]).map((environment) => (
          <Option
            key={environment}
            label={t(`environment.${environment}`)}
            selected={value.environment === environment}
            onSelect={() => onChange({ ...value, environment })}
          />
        ))}
      </ChoiceRow>
      <div className="my-1 h-px bg-[var(--chat-border)]" />
      <ChoiceRow
        label={t('filterGroupBy')}
        value={t(`groupBy.${value.groupBy}`)}
        open={openMenu === 'groupBy'}
        onToggle={() => setOpenMenu(openMenu === 'groupBy' ? null : 'groupBy')}
      >
        {(['folder', 'project', 'agent'] as GroupBy[]).map((groupBy) => (
          <Option
            key={groupBy}
            label={t(`groupBy.${groupBy}`)}
            selected={value.groupBy === groupBy}
            onSelect={() => onChange({ ...value, groupBy })}
          />
        ))}
      </ChoiceRow>
      <ChoiceRow
        label={t('filterSortBy')}
        value={t(`sortBy.${value.sortBy}`)}
        open={openMenu === 'sortBy'}
        onToggle={() => setOpenMenu(openMenu === 'sortBy' ? null : 'sortBy')}
      >
        {(['activity', 'name'] as SortBy[]).map((sortBy) => (
          <Option
            key={sortBy}
            label={t(`sortBy.${sortBy}`)}
            selected={value.sortBy === sortBy}
            onSelect={() => onChange({ ...value, sortBy })}
          />
        ))}
      </ChoiceRow>
      <div className="my-1 h-px bg-[var(--chat-border)]" />
      <ToggleRow
        label={t('filterEmptyGroups')}
        pressed={value.showEmptyGroups}
        onClick={() => onChange({ ...value, showEmptyGroups: !value.showEmptyGroups })}
      />
      <ToggleRow
        label={t('filterPrStatus')}
        pressed={value.showPrStatus}
        onClick={() => onChange({ ...value, showPrStatus: !value.showPrStatus })}
      />
    </div>
  )
}

function ChoiceRow({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string
  value: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button type="button" className={MENU_CLASS} onClick={onToggle}>
        <span>{label}</span>
        <span className="flex items-center gap-1 text-[var(--chat-muted)]">
          {value}
          <IconChevron />
        </span>
      </button>
      {open && <div className="bg-black/20 py-1">{children}</div>}
    </div>
  )
}

function Option({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" className={`${MENU_CLASS} pl-5`} onClick={onSelect}>
      <span>{label}</span>
      {selected && <IconCheck className="text-[var(--chat-text)]" />}
    </button>
  )
}

function ToggleRow({
  label,
  pressed,
  onClick,
}: {
  label: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={MENU_CLASS} onClick={onClick} aria-pressed={pressed}>
      <span>{label}</span>
      {pressed && <IconCheck />}
    </button>
  )
}
