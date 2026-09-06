'use client'

import { useTranslations } from 'next-intl'
import { relativeTime, sessionStatusPill } from '@/lib/chat-display'
import { EngineLogoForText } from '@/components/brand/engine-logo'
import { IconChevron } from '../desktop/chat-icons'
import type { ChatPullRequest } from '@/lib/github-pulls'
import type { ChatGitHubItem } from '../use-chat-github'

export interface HomeSessionRow {
  id: string
  title: string
  subtitle: string
  repo: string
  updatedAt: number
  active: boolean
  hasPr: boolean
  prState?: string | null
}

const ROW =
  'flex w-full cursor-pointer items-center gap-3 rounded-xl bg-[var(--chat-elevated)] px-3 py-2.5 text-left duration-200 hover:bg-white/5'

const KIND_KEY = { pull: 'feedPull', push: 'feedPush', commit: 'feedCommit' } as const

function asFeed(activity: ChatGitHubItem[] | undefined, pulls: ChatPullRequest[]): ChatGitHubItem[] {
  if (activity && activity.length > 0) return activity
  return pulls.map((pr) => ({
    id: `${pr.repo}#${pr.number}`,
    kind: 'pull',
    title: pr.title,
    repo: pr.repo,
    htmlUrl: pr.htmlUrl,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
  }))
}

function feedTime(value: string | number, now?: number): string {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms)) return ''
  return relativeTime(ms / 1000, now)
}

function pillClass(kind: string): string {
  if (kind === 'ready_for_review' || kind === 'open' || kind === 'pull') return 'text-[var(--chat-accent)]'
  if (kind === 'merged' || kind === 'push') return 'text-purple-300'
  if (kind === 'closed' || kind === 'commit') return 'text-[var(--chat-muted)]'
  if (kind === 'active') return 'text-[var(--chat-success)]'
  return 'text-[var(--chat-muted)]'
}

export function ChatHomeList({
  sessions,
  pullRequests,
  activity,
  onSelectSession,
  now,
}: {
  sessions: HomeSessionRow[]
  pullRequests: ChatPullRequest[]
  activity?: ChatGitHubItem[]
  onSelectSession: (id: string) => void
  now?: number
}) {
  const t = useTranslations('chatDesktop')
  const feed = asFeed(activity, pullRequests)
  return (
    <div className="mx-auto w-full max-w-3xl px-8">
      <section className="mb-8">
        <h2 className="mb-2 text-[13px] font-medium text-[var(--chat-text)]">{t('sessions')}</h2>
        {sessions.length === 0 ? (
          <p className="text-[13px] text-[var(--chat-muted)]">{t('noSessions')}</p>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((row) => {
              const pill = sessionStatusPill(row)
              return (
                <button key={row.id} type="button" className={ROW} onClick={() => onSelectSession(row.id)}>
                  <span className={`shrink-0 text-[12px] ${pillClass(pill)}`}>{t(`sessionPill.${pill}`)}</span>
                  <EngineLogoForText text={`${row.subtitle} ${row.title}`} size={18} decorative />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--chat-text)]">{row.title}</span>
                  <span className="hidden max-w-[180px] truncate text-[12px] text-[var(--chat-muted)] sm:block">{row.subtitle}</span>
                  <span className="hidden text-[12px] text-[var(--chat-muted)] md:block">{row.repo}</span>
                  <span className="text-[12px] text-[var(--chat-muted)]">{relativeTime(row.updatedAt, now)}</span>
                  <IconChevron />
                </button>
              )
            })}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-[var(--chat-text)]">{t('pullRequests')}</h2>
        {feed.length === 0 ? (
          <p className="text-[13px] text-[var(--chat-muted)]">{t('noPullRequests')}</p>
        ) : (
          <div className="space-y-1.5">
            {feed.map((item) => (
              <a key={item.id} href={item.htmlUrl || '#'} target="_blank" rel="noopener noreferrer" className={ROW}>
                <span className={`shrink-0 text-[12px] ${pillClass(item.kind)}`}>{t(KIND_KEY[item.kind])}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--chat-text)]">{item.title}</span>
                <span className="hidden text-[12px] text-[var(--chat-muted)] md:block">{item.repo.split('/')[1] || item.repo}</span>
                {item.commitCount != null ? <span className="text-[12px] text-[var(--chat-muted)]">{item.commitCount}</span> : null}
                {item.additions != null ? <span className="text-[12px] text-[var(--chat-success)]">+{item.additions}</span> : null}
                {item.deletions != null ? <span className="text-[12px] text-[var(--chat-danger)]">-{item.deletions}</span> : null}
                <span className="text-[12px] text-[var(--chat-muted)]">{feedTime(item.updatedAt, now)}</span>
                <IconChevron />
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
