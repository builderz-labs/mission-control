'use client'

import { useTranslations } from 'next-intl'
import { firstName } from '@/lib/chat-display'
import { IconSparkle } from '../desktop/chat-icons'
import { ChatHomeList, type HomeSessionRow } from './chat-home-list'
import type { ChatPullRequest } from '@/lib/github-pulls'
import type { ChatGitHubItem } from '../use-chat-github'

export function ChatWelcome({
  displayName,
  sessions,
  pullRequests,
  activity,
  onSelectSession,
  now,
}: {
  displayName: string
  sessions: HomeSessionRow[]
  pullRequests: ChatPullRequest[]
  activity?: ChatGitHubItem[]
  onSelectSession: (id: string) => void
  now?: number
}) {
  const t = useTranslations('chatDesktop')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-16">
      <div className="mx-auto mb-10 flex w-full max-w-3xl items-center gap-2 px-8">
        <IconSparkle className="h-5 w-5 text-[var(--chat-text)]" />
        <h1 className="text-[28px] font-medium tracking-tight text-[var(--chat-text)]">
          {t('welcomeBack', { name: firstName(displayName) })}
        </h1>
      </div>
      <ChatHomeList sessions={sessions} pullRequests={pullRequests} activity={activity} onSelectSession={onSelectSession} now={now} />
    </div>
  )
}
