'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Gateway, GatewayHealthProbe, GatewayHealthLogEntry } from './multi-gateway-panel-types'

// Maps gateway/probe status values to Tailwind dot colours.
const STATUS_COLORS: Readonly<Record<string, string>> = {
  online: 'bg-green-500',
  offline: 'bg-red-500',
  error: 'bg-amber-500',
  timeout: 'bg-amber-500',
  unknown: 'bg-muted-foreground/30',
}

interface GatewayCardProps {
  readonly gateway: Gateway
  readonly health?: GatewayHealthProbe
  readonly historyEntries?: readonly GatewayHealthLogEntry[]
  readonly isProbing: boolean
  readonly isCurrentlyConnected: boolean
  readonly onSetPrimary: () => void
  readonly onDelete: () => void
  readonly onConnect: () => void
  readonly onProbe: () => void
}

export function GatewayCard({
  gateway,
  health,
  historyEntries = [],
  isProbing,
  isCurrentlyConnected,
  onSetPrimary,
  onDelete,
  onConnect,
  onProbe,
}: GatewayCardProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  // Chronological slice for the sparkline (oldest → newest, max 10).
  const timelineEntries = historyEntries.length > 0
    ? [...historyEntries].slice(0, 10).reverse()
    : []
  const latestEntry = historyEntries[0]

  const lastSeen = gateway.last_seen
    ? new Date(gateway.last_seen * 1000).toLocaleString()
    : t('neverProbed')

  const dotColor = isCurrentlyConnected
    ? 'bg-green-500'
    : (STATUS_COLORS[gateway.status] ?? STATUS_COLORS.unknown)

  return (
    <div className={`bg-card border rounded-lg p-4 transition-smooth ${
      isCurrentlyConnected ? 'border-green-500/30 bg-green-500/5' : 'border-border'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <GatewayCardInfo
          gateway={gateway}
          health={health}
          dotColor={dotColor}
          isCurrentlyConnected={isCurrentlyConnected}
          lastSeen={lastSeen}
          timelineEntries={timelineEntries}
          latestEntry={latestEntry}
        />
        <GatewayCardActions
          gateway={gateway}
          isProbing={isProbing}
          isCurrentlyConnected={isCurrentlyConnected}
          onProbe={onProbe}
          onConnect={onConnect}
          onSetPrimary={onSetPrimary}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}

// ── Info column ────────────────────────────────────────────────────────────────

interface InfoProps {
  readonly gateway: Gateway
  readonly health?: GatewayHealthProbe
  readonly dotColor: string
  readonly isCurrentlyConnected: boolean
  readonly lastSeen: string
  readonly timelineEntries: readonly GatewayHealthLogEntry[]
  readonly latestEntry?: GatewayHealthLogEntry
}

function GatewayCardInfo({
  gateway, health, dotColor, isCurrentlyConnected, lastSeen, timelineEntries, latestEntry,
}: InfoProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <h3 className="text-sm font-semibold text-foreground">{gateway.name}</h3>
        {gateway.is_primary ? (
          <span className="text-2xs px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 font-medium">
            {t('primary')}
          </span>
        ) : null}
        {isCurrentlyConnected && (
          <span className="text-2xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 font-medium">
            {t('connectedBadge')}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{gateway.host}:{gateway.port}</span>
        <span>{t('token')}: {gateway.token_set ? t('tokenSet') : t('tokenNone')}</span>
        {gateway.latency != null && <span>{t('latency')}: {gateway.latency}ms</span>}
        <span>{t('last')}: {lastSeen}</span>
      </div>

      {health?.gateway_version && (
        <div className="mt-1 text-2xs text-muted-foreground">
          {t('gatewayVersion')}: <span className="font-mono text-foreground/80">{health.gateway_version}</span>
        </div>
      )}

      {health?.compatibility_warning && (
        <div className="mt-1.5 text-2xs rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 px-2 py-1">
          {health.compatibility_warning}
        </div>
      )}

      <GatewayTimeline timelineEntries={timelineEntries} latestEntry={latestEntry} />
    </div>
  )
}

// ── Sparkline timeline ─────────────────────────────────────────────────────────

interface TimelineProps {
  readonly timelineEntries: readonly GatewayHealthLogEntry[]
  readonly latestEntry?: GatewayHealthLogEntry
}

function GatewayTimeline({ timelineEntries, latestEntry }: TimelineProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 text-2xs text-muted-foreground">
      {timelineEntries.length > 0 ? (
        <div className="flex items-center gap-0.5">
          {timelineEntries.map((entry) => (
            <span
              key={`${entry.probed_at}-${entry.status}`}
              className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[entry.status] ?? STATUS_COLORS.unknown}`}
              title={`${entry.status} ${entry.latency != null ? `(${entry.latency}ms)` : '(n/a)'} @ ${new Date(entry.probed_at * 1000).toLocaleTimeString()}${entry.error ? ` — ${entry.error}` : ''}`}
            />
          ))}
        </div>
      ) : (
        <span className="text-2xs text-muted-foreground">{t('noHistory')}</span>
      )}
      <span title={t('colorKeyTitle')} className="text-2xs text-muted-foreground">
        {t('colorKey')}
      </span>
      {latestEntry?.latency != null && (
        <span className="text-2xs font-medium">{t('lastLatency', { ms: latestEntry.latency })}</span>
      )}
    </div>
  )
}

// ── Action buttons ─────────────────────────────────────────────────────────────

interface ActionsProps {
  readonly gateway: Gateway
  readonly isProbing: boolean
  readonly isCurrentlyConnected: boolean
  readonly onProbe: () => void
  readonly onConnect: () => void
  readonly onSetPrimary: () => void
  readonly onDelete: () => void
}

function GatewayCardActions({
  gateway, isProbing, isCurrentlyConnected, onProbe, onConnect, onSetPrimary, onDelete,
}: ActionsProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  return (
    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
      <Button
        onClick={onProbe}
        disabled={isProbing}
        variant="secondary"
        size="xs"
        className="text-2xs"
        title={t('probeGateway')}
      >
        {isProbing ? t('probing') : t('probe')}
      </Button>

      {!isCurrentlyConnected && (
        <Button
          onClick={onConnect}
          size="xs"
          className="text-2xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
          title={t('connectToGateway')}
        >
          {t('connect')}
        </Button>
      )}

      {!gateway.is_primary && (
        <>
          <Button
            onClick={onSetPrimary}
            variant="secondary"
            size="xs"
            className="text-2xs"
            title={t('setPrimaryTitle')}
          >
            {t('setPrimary')}
          </Button>
          <Button
            onClick={onDelete}
            variant="ghost"
            size="icon-xs"
            className="hover:text-red-400 hover:bg-red-500/10"
            title={t('removeGateway')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 4h10M6 4V3h4v1M5 4v8.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" />
            </svg>
          </Button>
        </>
      )}
    </div>
  )
}
