'use client'

import { useTranslations } from 'next-intl'
import { IconPlus } from './chat-icons'

export function ChatMobileBar({ onNew }: { onNew: () => void }) {
  const t = useTranslations('chatDesktop')
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-[var(--chat-border)] px-3 md:hidden">
      <button
        type="button"
        onClick={onNew}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-[var(--chat-text)]"
      >
        <IconPlus />
        {t('navNew')}
      </button>
    </div>
  )
}
