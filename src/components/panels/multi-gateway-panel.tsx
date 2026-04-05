'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { buildGatewayWebSocketUrl } from '@/lib/gateway-url'
import { GatewayCard } from './gateway-card'
import { AddGatewayForm } from './gateway-form'
import { DiscoveredGatewaysSection } from './discovered-gateways-section'
import { DirectConnectionsSection } from './direct-connections-section'
import type {
  Gateway,
  DirectConnection,
  GatewayHealthProbe,
  GatewayHistory,
  DiscoveredGateway,
} from './multi-gateway-panel-types'

export function MultiGatewayPanel(): React.ReactElement {
  const t = useTranslations('multiGateway')
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [directConnections, setDirectConnections] = useState<DirectConnection[]>([])
  const [discoveredGateways, setDiscoveredGateways] = useState<DiscoveredGateway[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [probing, setProbing] = useState<number | null>(null)
  const [healthByGatewayId, setHealthByGatewayId] = useState<Map<number, GatewayHealthProbe>>(new Map())
  const [historyByGatewayId, setHistoryByGatewayId] = useState<Record<number, GatewayHistory>>({})
  const { connection } = useMissionControl()
  const { connect } = useWebSocket()

  // ── Data fetchers ────────────────────────────────────────────────────────────

  const fetchGateways = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/gateways', { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      setGateways(data.gateways || [])
    } catch { /* connection errors are surfaced via status indicators */ }
    setLoading(false)
  }, [])

  const fetchDirectConnections = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/connect', { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      setDirectConnections(data.connections || [])
    } catch { /* ignore */ }
  }, [])

  const fetchDiscovered = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/gateways/discover', { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      setDiscoveredGateways(data.gateways || [])
    } catch { /* ignore */ }
  }, [])

  const fetchHistory = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/gateways/health/history', { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      const map: Record<number, GatewayHistory> = {}
      for (const entry of data.history || []) {
        map[entry.gatewayId] = entry
      }
      setHistoryByGatewayId(map)
    } catch {
      setHistoryByGatewayId({})
    }
  }, [])

  useEffect(() => {
    fetchGateways()
    fetchDirectConnections()
    fetchDiscovered()
    fetchHistory()
  }, [fetchGateways, fetchDirectConnections, fetchDiscovered, fetchHistory])

  // ── Connection matching ──────────────────────────────────────────────────────

  const gatewayMatchesConnection = useCallback((gw: Gateway): boolean => {
    const url = connection.url
    if (!url) return false
    const normalizedConn = url.toLowerCase()
    const normalizedHost = String(gw.host || '').toLowerCase()

    if (normalizedHost && normalizedConn.includes(normalizedHost)) return true
    if (normalizedConn.includes(`:${gw.port}`)) return true

    try {
      const derivedWs = buildGatewayWebSocketUrl({
        host: gw.host,
        port: gw.port,
        browserProtocol: window.location.protocol,
      }).toLowerCase()
      return normalizedConn.includes(derivedWs)
    } catch {
      return false
    }
  }, [connection.url])

  const shouldShowConnectionSummary =
    gateways.length === 0 || !gateways.some(gatewayMatchesConnection)

  // ── Gateway actions ──────────────────────────────────────────────────────────

  const probeAll = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/gateways/health', { method: 'POST', signal: AbortSignal.timeout(8000) })
      const data = await res.json().catch(() => ({}))
      const rows = Array.isArray(data?.results) ? data.results as GatewayHealthProbe[] : []
      const mapped = new Map<number, GatewayHealthProbe>()
      for (const row of rows) {
        if (typeof row?.id === 'number') mapped.set(row.id, row)
      }
      setHealthByGatewayId(mapped)
    } catch { /* ignore */ }
    fetchGateways()
    fetchHistory()
  }, [fetchGateways, fetchHistory])

  const handleProbeGateway = useCallback(async (gw: Gateway): Promise<void> => {
    setProbing(gw.id)
    await probeAll()
    setProbing(null)
  }, [probeAll])

  const handleSetPrimary = useCallback(async (gw: Gateway): Promise<void> => {
    await fetch('/api/gateways', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gw.id, is_primary: 1 }),
      signal: AbortSignal.timeout(8000),
    })
    fetchGateways()
    fetchHistory()
  }, [fetchGateways, fetchHistory])

  const handleDeleteGateway = useCallback(async (id: number): Promise<void> => {
    await fetch('/api/gateways', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(8000),
    })
    fetchGateways()
    fetchHistory()
  }, [fetchGateways, fetchHistory])

  const handleConnectTo = useCallback(async (gw: Gateway): Promise<void> => {
    try {
      const res = await fetch('/api/gateways/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gw.id }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return
      const payload = await res.json()
      const wsUrl = String(payload?.ws_url || buildGatewayWebSocketUrl({
        host: gw.host,
        port: gw.port,
        browserProtocol: window.location.protocol,
      }))
      connect(wsUrl, String(payload?.token || ''))
    } catch { /* connection status will remain disconnected */ }
  }, [connect])

  const handleRegisterDiscovered = useCallback(async (dg: DiscoveredGateway): Promise<void> => {
    await fetch('/api/gateways', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: dg.user, host: '127.0.0.1', port: dg.port, is_primary: false }),
      signal: AbortSignal.timeout(8000),
    })
    fetchGateways()
    fetchDiscovered()
  }, [fetchGateways, fetchDiscovered])

  const handleDisconnectCli = useCallback(async (connectionId: string): Promise<void> => {
    try {
      await fetch('/api/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connectionId }),
        signal: AbortSignal.timeout(8000),
      })
      fetchDirectConnections()
    } catch { /* ignore */ }
  }, [fetchDirectConnections])

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PanelHeader
        onProbeAll={probeAll}
        onToggleAdd={() => setShowAdd(v => !v)}
        showAdd={showAdd}
      />

      {shouldShowConnectionSummary && (
        <ConnectionSummary connection={connection} />
      )}

      {showAdd && (
        <AddGatewayForm
          onAdded={() => { fetchGateways(); setShowAdd(false) }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <GatewayList
        loading={loading}
        gateways={gateways}
        healthByGatewayId={healthByGatewayId}
        historyByGatewayId={historyByGatewayId}
        probing={probing}
        gatewayMatchesConnection={gatewayMatchesConnection}
        onSetPrimary={handleSetPrimary}
        onDelete={handleDeleteGateway}
        onConnect={handleConnectTo}
        onProbe={handleProbeGateway}
      />

      <DiscoveredGatewaysSection
        discovered={discoveredGateways}
        registered={gateways}
        onRefresh={fetchDiscovered}
        onRegister={handleRegisterDiscovered}
      />

      <DirectConnectionsSection
        connections={directConnections}
        onRefresh={fetchDirectConnections}
        onDisconnect={handleDisconnectCli}
      />
    </div>
  )
}

// ── Header ─────────────────────────────────────────────────────────────────────

interface PanelHeaderProps {
  readonly onProbeAll: () => void
  readonly onToggleAdd: () => void
  readonly showAdd: boolean
}

function PanelHeader({ onProbeAll, onToggleAdd }: PanelHeaderProps): React.ReactElement {
  const t = useTranslations('multiGateway')
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('description')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onProbeAll} variant="secondary" size="sm">{t('probeAll')}</Button>
        <Button onClick={onToggleAdd} size="sm">{t('addGateway')}</Button>
      </div>
    </div>
  )
}

// ── Connection summary banner ──────────────────────────────────────────────────

interface ConnectionSummaryProps {
  readonly connection: { isConnected: boolean; url?: string; latency?: number | null }
}

function ConnectionSummary({ connection }: ConnectionSummaryProps): React.ReactElement {
  const t = useTranslations('multiGateway')
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${connection.isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
        <div>
          <div className="text-sm font-medium text-foreground">
            {connection.isConnected ? t('connected') : t('disconnected')}
          </div>
          <div className="text-xs text-muted-foreground">
            {connection.url || t('noActiveConnection')}
            {connection.latency != null && ` (${connection.latency}ms)`}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Gateway list (loading / empty / populated) ─────────────────────────────────

interface GatewayListProps {
  readonly loading: boolean
  readonly gateways: readonly Gateway[]
  readonly healthByGatewayId: ReadonlyMap<number, GatewayHealthProbe>
  readonly historyByGatewayId: Readonly<Record<number, GatewayHistory>>
  readonly probing: number | null
  readonly gatewayMatchesConnection: (gw: Gateway) => boolean
  readonly onSetPrimary: (gw: Gateway) => Promise<void>
  readonly onDelete: (id: number) => Promise<void>
  readonly onConnect: (gw: Gateway) => Promise<void>
  readonly onProbe: (gw: Gateway) => Promise<void>
}

function GatewayList({
  loading, gateways, healthByGatewayId, historyByGatewayId,
  probing, gatewayMatchesConnection, onSetPrimary, onDelete, onConnect, onProbe,
}: GatewayListProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  if (loading) {
    return <div className="text-center text-xs text-muted-foreground py-8">{t('loadingGateways')}</div>
  }

  if (gateways.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg">
        <p className="text-sm text-muted-foreground">{t('noGateways')}</p>
        <p className="text-xs text-muted-foreground mt-1">{t('addGatewayHint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {gateways.map(gw => (
        <GatewayCard
          key={gw.id}
          gateway={gw}
          health={healthByGatewayId.get(gw.id)}
          historyEntries={historyByGatewayId[gw.id]?.entries || []}
          isProbing={probing === gw.id}
          isCurrentlyConnected={gatewayMatchesConnection(gw)}
          onSetPrimary={() => onSetPrimary(gw)}
          onDelete={() => onDelete(gw.id)}
          onConnect={() => onConnect(gw)}
          onProbe={() => onProbe(gw)}
        />
      ))}
    </div>
  )
}
