'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl, type ConnectionStatus } from '@/store'
import { extractWsHost } from '@/lib/agent-card-helpers'

interface ModeBadgeProps {
  connection: ConnectionStatus
  onReconnect: () => void
}

/** Top-left mode + connection badge — visible on all screen sizes. */
export function ModeBadge({ connection, onReconnect }: ModeBadgeProps): React.ReactElement | null {
  const { dashboardMode } = useMissionControl()
  const th = useTranslations('header')
  const isLocal = dashboardMode === 'local'
  const [showTooltip, setShowTooltip] = useState(false)

  if (isLocal) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-2xs bg-void-cyan/10 border border-void-cyan/25">
        <span className="w-1.5 h-1.5 rounded-full bg-void-cyan" />
        <span className="font-medium text-void-cyan">{th('local')}</span>
      </div>
    )
  }

  const isConnected = connection.isConnected
  const isReconnecting = !isConnected && connection.reconnectAttempts > 0
  const { dotClass, borderClass, textClass, statusLabel } = resolveConnectionStyle(
    isConnected, isReconnecting, connection, th,
  )
  const wsHost = extractWsHost(connection.url)

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={!isConnected ? onReconnect : undefined}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-2xs border ${borderClass} ${
          !isConnected ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
        } transition-all`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className={`font-medium ${textClass}`}>GW</span>
        <span className={`font-mono ${textClass} opacity-80`}>{statusLabel}</span>
      </button>

      {showTooltip && (
        <ConnectionTooltip
          connection={connection}
          isConnected={isConnected}
          isReconnecting={isReconnecting}
          wsHost={wsHost}
        />
      )}
    </div>
  )
}

interface ConnectionStyle {
  dotClass: string
  borderClass: string
  textClass: string
  statusLabel: string
}

function resolveConnectionStyle(
  isConnected: boolean,
  isReconnecting: boolean,
  connection: ConnectionStatus,
  th: ReturnType<typeof useTranslations<'header'>>,
): ConnectionStyle {
  if (isConnected) {
    return {
      dotClass: 'bg-green-500',
      borderClass: 'border-green-500/25 bg-green-500/10',
      textClass: 'text-green-400',
      statusLabel: connection.latency != null ? `${connection.latency}ms` : th('connected'),
    }
  }
  if (isReconnecting) {
    return {
      dotClass: 'bg-amber-500 animate-pulse',
      borderClass: 'border-amber-500/25 bg-amber-500/10',
      textClass: 'text-amber-400',
      statusLabel: th('retry', { count: connection.reconnectAttempts }),
    }
  }
  return {
    dotClass: 'bg-red-500 animate-pulse',
    borderClass: 'border-red-500/25 bg-red-500/10',
    textClass: 'text-red-400',
    statusLabel: th('offline'),
  }
}

interface ConnectionTooltipProps {
  connection: ConnectionStatus
  isConnected: boolean
  isReconnecting: boolean
  wsHost: string
}

function ConnectionTooltip({
  connection,
  isConnected,
  isReconnecting,
  wsHost,
}: ConnectionTooltipProps): React.ReactElement {
  const th = useTranslations('header')

  return (
    <div className="absolute top-full left-0 mt-1.5 z-50 w-56 rounded-lg border border-border bg-card/95 backdrop-blur-md p-3 shadow-xl text-xs">
      <div className="font-medium text-foreground mb-2">{th('gatewayConnection')}</div>
      <div className="space-y-1.5 text-muted-foreground">
        <div className="flex justify-between">
          <span>{th('status')}</span>
          <span className={isConnected ? 'text-green-400' : isReconnecting ? 'text-amber-400' : 'text-red-400'}>
            {isConnected ? th('connected') : isReconnecting ? th('reconnecting') : th('disconnected')}
          </span>
        </div>
        <div className="flex justify-between">
          <span>{th('host')}</span>
          <span className="font-mono text-foreground/80 truncate ml-2">{wsHost}</span>
        </div>
        {connection.latency != null && (
          <div className="flex justify-between">
            <span>{th('latency')}</span>
            <span className="font-mono text-foreground/80">{connection.latency}ms</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>{th('webSocket')}</span>
          <span className={isConnected ? 'text-green-400' : 'text-red-400'}>
            {isConnected ? th('live') : th('down')}
          </span>
        </div>
        <div className="flex justify-between">
          <span>{th('sse')}</span>
          <span className={connection.sseConnected ? 'text-green-400' : 'text-muted-foreground/50'}>
            {connection.sseConnected ? th('live') : th('off')}
          </span>
        </div>
        {!isConnected && connection.reconnectAttempts > 0 && (
          <div className="flex justify-between">
            <span>{th('retries')}</span>
            <span className="text-amber-400">{connection.reconnectAttempts}</span>
          </div>
        )}
      </div>
      {!isConnected && (
        <div className="mt-2 pt-2 border-t border-border/40 text-muted-foreground/60 text-[10px]">
          {th('clickToReconnect')}
        </div>
      )}
    </div>
  )
}
