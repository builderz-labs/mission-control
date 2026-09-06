'use client'

import { useTranslations } from 'next-intl'
import { relativeTime } from '@/lib/chat-display'
import { ENGINE_LABELS, type TreeKind } from '@/lib/chat-session-identity'
import { EngineLogo } from '@/components/brand/engine-logo'
import { engineFromKind } from '@/lib/chat-model-groups'
import { contextPercent } from '@/lib/chat-session-metrics'
import { ContextWindowBar } from '../session/context-window-bar'
import { ChatLiveDot } from './chat-live-dot'

export interface GitLensSessionRow {
  id: string
  kind: TreeKind
  title: string
  model?: string
  updatedAt: number
  tokens?: string
  age?: string
  active?: boolean
}

export function ChatSessionRow({
  session,
  selected,
  onSelect,
  now,
}: {
  session: GitLensSessionRow
  selected: boolean
  onSelect: (id: string) => void
  now?: number
}) {
  const t = useTranslations('chatDesktop')
  const engine = engineFromKind(session.kind)
  const percent = contextPercent(session.tokens, session.model)
  const live = !!session.active
  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-md py-1 pl-5 pr-2 text-left text-[12px] duration-200 ${
        selected ? 'bg-white/8 text-[var(--chat-text)]' : 'text-[var(--chat-muted)] hover:bg-white/5 hover:text-[var(--chat-text)]'
      }`}
    >
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <span className={`absolute left-1/2 top-[-6px] h-2 w-px -translate-x-1/2 ${live ? 'bg-[var(--chat-success)]' : 'bg-[var(--chat-border)]'}`} />
        {engine ? <EngineLogo engine={engine} size={16} decorative /> : <span className="text-[9px]">{ENGINE_LABELS[session.kind][0]}</span>}
      </span>
      <ChatLiveDot live={live} label={t(live ? 'sessionPill.active' : 'sessionPill.idle')} />
      <span className="min-w-0 flex-1 truncate">{session.title}</span>
      <ContextWindowBar compact percent={percent} tokens={session.tokens} duration={session.age} />
      <span className="shrink-0 text-[11px] opacity-70">{relativeTime(session.updatedAt, now)}</span>
    </button>
  )
}
