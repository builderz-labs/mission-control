'use client'

import { useTranslations } from 'next-intl'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { IconClose } from '../desktop/chat-icons'

export function SessionPlanPanel({
  title,
  markdown,
  onClose,
}: {
  title: string
  markdown: string
  onClose: () => void
}) {
  const t = useTranslations('chatDesktop')

  const share = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
    } catch {
      // Clipboard can fail without permission; the panel still stays open.
    }
  }

  return (
    <aside className="hidden h-full w-[400px] shrink-0 flex-col border-l border-[var(--chat-border)] bg-[var(--chat-bg)] lg:flex">
      <div className="flex h-11 items-center gap-2 border-b border-[var(--chat-border)] px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--chat-text)]">{title}</span>
        <button type="button" onClick={share} className="text-[12px] text-[var(--chat-muted)] hover:text-[var(--chat-text)]">
          {t('share')}
        </button>
        <button type="button" onClick={onClose} aria-label={t('closePlan')}>
          <IconClose />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[var(--chat-text)]">
        <div className="chat-plan-prose">
          <MarkdownRenderer content={markdown} />
        </div>
      </div>
    </aside>
  )
}
