'use client'

import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'

interface SystemActionLine {
  id: string
  message: string
  detail: string
  tone: 'info' | 'warn' | 'error'
  timestamp: number
}

export function SystemNowPanel({
  className = '',
  maxLines = 4,
}: {
  className?: string
  maxLines?: number
}) {
  const { logs, sessions, activities, connection, runtimeSignals } = useMissionControl()
  const [systemActionLines, setSystemActionLines] = useState<SystemActionLine[]>([])
  const [listeningFrame, setListeningFrame] = useState(1)

  const currentSystemAction = deriveCurrentSystemAction({
    connection,
    runtimeSignals,
    logs,
    activities,
    activeSessions: sessions.filter((session) => session.active).length,
  })

  useEffect(() => {
    setSystemActionLines((state) => appendSystemAction(state, currentSystemAction, maxLines))
  }, [currentSystemAction.detail, currentSystemAction.message, currentSystemAction.tone, maxLines])

  useEffect(() => {
    const interval = setInterval(() => {
      setListeningFrame((frame) => (frame % 3) + 1)
    }, 700)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className={`border-b border-border/70 bg-background/60 px-3 py-2.5 shrink-0 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            System Now
          </div>
          <div className="mt-0.5 text-xs text-foreground">
            <span>{stripTrailingDots(currentSystemAction.message)}</span>
            <span className="inline-block w-4 text-left">{'.'.repeat(listeningFrame)}</span>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-2xs ${
          currentSystemAction.tone === 'error'
            ? 'bg-red-500/10 text-red-400'
            : currentSystemAction.tone === 'warn'
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-emerald-500/10 text-emerald-400'
        }`}>
          live
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {systemActionLines.length === 0 ? (
          <div className="rounded-md border border-border/60 bg-card/70 px-2 py-1.5 text-2xs text-muted-foreground">
            Waiting for system activity...
          </div>
        ) : (
          systemActionLines.map((line) => (
            <div key={line.id} className="rounded-md border border-border/60 bg-card/80 px-2 py-1.5">
              <div className="flex items-start gap-2">
                <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  line.tone === 'error'
                    ? 'bg-red-500'
                    : line.tone === 'warn'
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="text-2xs text-foreground leading-relaxed break-words">
                    {line.message}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>{line.detail}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(line.timestamp)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
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

function deriveCurrentSystemAction({
  connection,
  runtimeSignals,
  logs,
  activities,
  activeSessions,
}: {
  connection: {
    isConnected: boolean
    url: string
    reconnectAttempts: number
    sseConnected?: boolean
  }
  runtimeSignals: Array<{
    id: string
    message: string
    detail: string
    tone: 'info' | 'warn' | 'error'
    priority: number
    updatedAt: number
  }>
  logs: Array<{
    timestamp: number
    level: 'info' | 'warn' | 'error' | 'debug'
    source: string
    message: string
  }>
  activities: Array<{
    created_at: number
    actor: string
    description: string
  }>
  activeSessions: number
}): Omit<SystemActionLine, 'id' | 'timestamp'> {
  const preferredRuntimeSignal = [...runtimeSignals].sort((a, b) =>
    b.priority - a.priority || b.updatedAt - a.updatedAt
  )[0]

  if (preferredRuntimeSignal) {
    return {
      message: preferredRuntimeSignal.message,
      detail: preferredRuntimeSignal.detail,
      tone: preferredRuntimeSignal.tone,
    }
  }

  if (connection.sseConnected === false) {
    return {
      message: 'Trying to connect to event stream...',
      detail: `round ${Math.max(connection.reconnectAttempts, 0) + 1}`,
      tone: 'warn',
    }
  }

  if (connection.url && !connection.isConnected) {
    return {
      message: 'Trying to connect to API...',
      detail: `round ${Math.max(connection.reconnectAttempts, 0) + 1}`,
      tone: 'warn',
    }
  }

  const latestLog = logs[0]
  const latestActivity = activities[0]
  const latestLogTs = latestLog?.timestamp ?? 0
  const latestActivityTs = latestActivity ? latestActivity.created_at * 1000 : 0

  if (latestLog && latestLogTs >= latestActivityTs) {
    return {
      message: normalizeSystemMessage(latestLog.message),
      detail: latestLog.source || 'system',
      tone: latestLog.level === 'error' ? 'error' : latestLog.level === 'warn' ? 'warn' : 'info',
    }
  }

  if (latestActivity) {
    return {
      message: normalizeSystemMessage(latestActivity.description),
      detail: latestActivity.actor || 'system',
      tone: 'info',
    }
  }

  if (activeSessions > 0) {
    return {
      message: 'Loading agent activity...',
      detail: `${activeSessions} active session${activeSessions === 1 ? '' : 's'}`,
      tone: 'info',
    }
  }

  return {
    message: 'Monitoring system state...',
    detail: 'waiting for the next event',
    tone: 'info',
  }
}

function appendSystemAction(
  state: SystemActionLine[],
  action: Omit<SystemActionLine, 'id' | 'timestamp'>,
  maxLines: number,
) {
  const now = Date.now()
  const normalizedMessage = stripTrailingDots(action.message)
  const lastLine = state[0]
  const isSameAsLast =
    stripTrailingDots(lastLine?.message || '') === normalizedMessage &&
    lastLine?.detail === action.detail &&
    lastLine?.tone === action.tone

  if (isSameAsLast) {
    return state
  }

  return [
    {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      message: normalizedMessage,
      detail: action.detail,
      tone: action.tone,
      timestamp: now,
    },
    ...state,
  ].slice(0, maxLines)
}

function normalizeSystemMessage(message: string) {
  const trimmed = message.trim()
  if (!trimmed) return 'Monitoring system state...'

  if (/gateway connection failed/i.test(trimmed)) {
    return 'Trying to connect to API...'
  }

  if (/No heartbeat response/i.test(trimmed)) {
    return 'Heartbeat lost. Reconnecting to API...'
  }

  if (/max reconnection attempts/i.test(trimmed)) {
    return 'API connection stalled. Waiting for retry...'
  }

  return trimmed.length > 56 ? `${trimmed.slice(0, 56)}...` : trimmed
}

function stripTrailingDots(message: string) {
  return message.replace(/\.*$/, '')
}
