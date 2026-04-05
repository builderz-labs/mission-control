'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { DirectConnection } from './multi-gateway-panel-types'

interface DirectConnectionsSectionProps {
  readonly connections: readonly DirectConnection[]
  readonly onRefresh: () => void
  readonly onDisconnect: (connectionId: string) => Promise<void>
}

export function DirectConnectionsSection({
  connections,
  onRefresh,
  onDisconnect,
}: DirectConnectionsSectionProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('directCliConnections')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('directCliDesc')}</p>
        </div>
        <Button onClick={onRefresh} variant="secondary" size="xs" className="text-2xs">
          {t('refresh')}
        </Button>
      </div>

      {connections.length === 0 ? (
        <EmptyConnectionsState />
      ) : (
        <div className="space-y-2">
          {connections.map(conn => (
            <DirectConnectionRow key={conn.id} conn={conn} onDisconnect={onDisconnect} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyConnectionsState(): React.ReactElement {
  const t = useTranslations('multiGateway')
  return (
    <div className="text-center py-8 bg-card border border-border rounded-lg">
      <p className="text-xs text-muted-foreground">{t('noDirectConnections')}</p>
      <p className="text-2xs text-muted-foreground mt-1">
        {t('useApiConnect')}{' '}
        <code className="font-mono bg-secondary px-1 rounded">POST /api/connect</code>{' '}
        {t('toRegisterCli')}
      </p>
    </div>
  )
}

// ── Single connection row ──────────────────────────────────────────────────────

interface DirectConnectionRowProps {
  readonly conn: DirectConnection
  readonly onDisconnect: (connectionId: string) => Promise<void>
}

function DirectConnectionRow({ conn, onDisconnect }: DirectConnectionRowProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  const isConnected = conn.status === 'connected'
  const statusBadgeClass = isConnected
    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
    : 'bg-red-500/20 text-red-400 border border-red-500/30'

  const heartbeatLabel = conn.last_heartbeat
    ? new Date(conn.last_heartbeat * 1000).toLocaleString()
    : t('never')

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-semibold text-foreground">{conn.agent_name}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">
              {conn.tool_name}{conn.tool_version ? ` v${conn.tool_version}` : ''}
            </span>
            <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${statusBadgeClass}`}>
              {conn.status.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
            <span>{t('role')}: {conn.agent_role || 'cli'}</span>
            <span>{t('heartbeat')}: {heartbeatLabel}</span>
            <span className="font-mono text-2xs">{conn.connection_id.slice(0, 8)}...</span>
          </div>
        </div>
        {isConnected && (
          <Button
            onClick={() => onDisconnect(conn.connection_id)}
            variant="ghost"
            size="xs"
            className="text-2xs text-red-400 hover:bg-red-500/10"
          >
            {t('disconnect')}
          </Button>
        )}
      </div>
    </div>
  )
}
