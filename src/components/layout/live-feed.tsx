'use client'

import { useMissionControl } from '@/store'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export function LiveFeed() {
  const { logs, sessions, activities, connection, dashboardMode, toggleLiveFeed } = useMissionControl()
  const t = useTranslations('liveFeed')
  const isLocal = dashboardMode === 'local'
  const [expanded, setExpanded] = useState(false)
  const [hasCollapsed, setHasCollapsed] = useState(false)

  // Combine logs, activities, and (in local mode) session events into a unified feed
  const sessionItems = isLocal
    ? sessions.slice(0, 10).map(s => ({
        id: `sess-${s.id}`,
        type: 'session' as const,
        level: 'info' as const,
        message: `${s.active ? t('activeSession') : t('idleSession')} session: ${s.key || s.id}`,
        source: s.model?.split('/').pop()?.split('-').slice(0, 2).join('-') || 'claude',
        timestamp: s.lastActivity || s.startTime || Date.now(),
      }))
    : []

  const feedItems = [
    ...logs.slice(0, 30).map(log => ({
      id: `log-${log.id}`,
      type: 'log' as const,
      level: log.level,
      message: log.message,
      source: log.source,
      timestamp: log.timestamp,
    })),
    ...activities.slice(0, 20).map(act => ({
      id: `act-${act.id}`,
      type: 'activity' as const,
      level: 'info' as const,
      message: act.description,
      source: act.actor,
      timestamp: act.created_at * 1000,
    })),
    ...sessionItems,
  ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 40)

  if (!expanded) {
    return (
      <div className="w-10 bg-card border-l border-border flex flex-col items-center py-3 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded(true)}
          title={t('showLiveFeed')}
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
        {/* Mini indicators */}
        <div className="mt-4 flex flex-col gap-2 items-center">
          {feedItems.slice(0, 5).map((item) => (
            <div
              key={item.id}
              className={`w-1.5 h-1.5 rounded-full ${
                item.level === 'error' ? 'bg-red-500' :
                item.level === 'warn' ? 'bg-amber-500' :
                'bg-blue-500/40'
              }`}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`w-72 h-full bg-card border-l border-border flex flex-col shrink-0${hasCollapsed ? ' slide-in-right' : ''}`}>
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 pulse-dot" />
          <span className="text-xs font-semibold text-foreground">{t('liveFeed')}</span>
          <span className="text-2xs text-muted-foreground font-mono-tight">{feedItems.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => { setExpanded(false); setHasCollapsed(true) }}
            className="w-6 h-6"
            title={t('collapseFeed')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleLiveFeed}
            className="w-6 h-6"
            title={t('closeFeed')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Feed items */}
      <div className="flex-1 overflow-y-auto">
        {feedItems.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-muted-foreground">{t('noActivityYet')}</p>
            <p className="text-2xs text-muted-foreground/60 mt-1">
              {isLocal
                ? t('eventsAppearLocal')
                : t('eventsStreamGateway')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {feedItems.map((item) => (
              <FeedItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Active sessions mini-list */}
      <div className="border-t border-border px-3 py-2 shrink-0">
        <div className="text-2xs font-medium text-muted-foreground mb-1.5">{t('activeSessions')}</div>
        <div className="space-y-1">
          {sessions.filter(s => s.active).slice(0, 4).map(session => (
            <div key={session.id} className="flex items-center gap-1.5 text-2xs">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-foreground truncate flex-1 font-mono-tight">{session.key || session.id}</span>
              <span className="text-muted-foreground">{session.model?.split('/').pop()?.slice(0, 8)}</span>
            </div>
          ))}
          {sessions.filter(s => s.active).length === 0 && (
            <div className="text-2xs text-muted-foreground">{t('noActiveSessions')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function FeedItem({ item }: { item: { id: string; type: string; level: string; message: string; source: string; timestamp: number } }) {
  const levelIndicator = item.level === 'error'
    ? 'bg-red-500'
    : item.level === 'warn'
    ? 'bg-amber-500'
    : item.level === 'debug'
    ? 'bg-gray-500'
    : 'bg-blue-500/50'

  const timeStr = formatRelativeTime(item.timestamp)

  return (
    <div className="px-3 py-2 hover:bg-secondary/50 transition-smooth group">
      <div className="flex items-start gap-2">
        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${levelIndicator}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground/90 leading-relaxed break-words">
            {item.message.length > 120 ? item.message.slice(0, 120) + '...' : item.message}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-2xs text-muted-foreground font-mono-tight">{item.source}</span>
            <span className="text-2xs text-muted-foreground/50">·</span>
            <span className="text-2xs text-muted-foreground">{timeStr}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}
