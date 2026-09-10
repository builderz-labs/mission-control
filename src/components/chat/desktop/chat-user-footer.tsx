'use client'

import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { firstName } from '@/lib/chat-display'
import { IconSparkle } from './chat-icons'

export function ChatUserFooter() {
  const t = useTranslations('chatDesktop')
  const { currentUser, subscription } = useMissionControl()
  const name = currentUser?.display_name || currentUser?.username || t('operator')
  const plan = subscription?.type || subscription?.rateLimitTier || t('localPlan')
  const initial = firstName(name).charAt(0).toUpperCase()

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-[var(--chat-border)] px-3">
      {currentUser?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUser.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[11px] font-medium">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-[var(--chat-text)]">{name}</div>
        <div className="truncate text-[11px] text-[var(--chat-muted)]">{plan}</div>
      </div>
      <IconSparkle className="h-3.5 w-3.5 shrink-0 text-[var(--chat-muted)]" />
    </div>
  )
}
