'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  IconArtifacts,
  IconChevron,
  IconClock,
  IconCustomize,
  IconDispatch,
  IconPlus,
} from './chat-icons'

const NAV_CLASS =
  'flex h-8 w-full items-center gap-2 rounded-md px-3 text-[13px] text-[var(--chat-muted)] hover:bg-white/5 hover:text-[var(--chat-text)]'

const MORE_ITEMS = [
  { id: 'overview', labelKey: 'moreOverview' },
  { id: 'agents', labelKey: 'moreAgents' },
  { id: 'logs', labelKey: 'moreLogs' },
  { id: 'github', labelKey: 'moreGithub' },
  { id: 'office', labelKey: 'moreOffice' },
  { id: 'monitor', labelKey: 'moreMonitor' },
] as const

export function ChatNav({
  onNew,
  onNavigate,
  onCustomize,
}: {
  onNew: () => void
  onNavigate: (panel: string) => void
  onCustomize: () => void
}) {
  const t = useTranslations('chatDesktop')
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <nav className="px-2 pt-3" aria-label={t('primaryNav')}>
      <button type="button" className={NAV_CLASS} onClick={onNew}>
        <IconPlus />
        {t('navNew')}
      </button>
      <button type="button" className={NAV_CLASS} onClick={() => onNavigate('memory')}>
        <IconArtifacts />
        {t('navArtifacts')}
      </button>
      <button type="button" className={NAV_CLASS} onClick={() => onNavigate('cron')}>
        <IconClock />
        {t('navRoutines')}
      </button>
      <button type="button" className={NAV_CLASS} onClick={() => onNavigate('tasks')}>
        <IconDispatch />
        <span className="flex-1 text-left">{t('navDispatch')}</span>
        <span className="rounded bg-white/8 px-1.5 py-px text-[10px] text-[var(--chat-muted)]">{t('beta')}</span>
      </button>
      <button type="button" className={NAV_CLASS} onClick={onCustomize}>
        <IconCustomize />
        {t('navCustomize')}
      </button>
      <div className="relative">
        <button type="button" className={NAV_CLASS} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>
          <IconChevron className={`h-3.5 w-3.5 ${moreOpen ? 'rotate-90' : ''}`} />
          {t('navMore')}
        </button>
        {moreOpen && (
          <div className="absolute left-2 right-2 z-20 mt-1 rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] py-1 shadow-xl">
            {MORE_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={NAV_CLASS}
                onClick={() => {
                  setMoreOpen(false)
                  onNavigate(item.id)
                }}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
