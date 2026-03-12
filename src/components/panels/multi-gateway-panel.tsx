'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { buildGatewayWebSocketUrl } from '@/lib/gateway-url'

interface Gateway {
  id: number
  name: string
  host: string
  port: number
  token_set: boolean
  is_primary: number
  status: string
  last_seen: number | null
  latency: number | null
  sessions_count: number
  agents_count: number
  created_at: number
  updated_at: number
}

interface DirectConnection {
  id: number
  agent_id: number
  tool_name: string
  tool_version: string | null
  connection_id: string
  status: string
  last_heartbeat: number | null
  metadata: string | null
  created_at: number
  agent_name: string
  agent_status: string
  agent_role: string
}

interface GatewayHealthProbe {
  id: number
  name: string
  status: 'online' | 'offline' | 'error'
  latency: number | null
  gateway_version?: string | null
  compatibility_warning?: string
  error?: string
}

interface GatewayHealthLogEntry {
  status: string
  latency: number | null
  probed_at: number
  error: string | null
}

interface GatewayHistory {
  gatewayId: number
  name: string | null
  entries: GatewayHealthLogEntry[]
}

interface DiscoveredGateway {
  user: string
  port: number
  bind: string
  mode: string
  active: boolean
  tailscale?: { mode: string }
}

export function MultiGatewayPanel() {
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

  const fetchGateways = useCallback(async () => {
    try {
      const res = await fetch('/api/gateways')
      const data = await res.json()
      setGateways(data.gateways || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  const fetchDirectConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/connect')
      const data = await res.json()
      setDirectConnections(data.connections || [])
    } catch { /* ignore */ }
  }, [])

  const fetchDiscovered = useCallback(async () => {
    try {
      const res = await fetch('/api/gateways/discover')
      const data = await res.json()
      setDiscoveredGateways(data.gateways || [])
    } catch { /* ignore */ }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/gateways/health/history')
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

  useEffect(() => { fetchGateways(); fetchDirectConnections(); fetchDiscovered(); fetchHistory() }, [fetchGateways, fetchDirectConnections, fetchDiscovered, fetchHistory])

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
    gateways.length === 0 ||
    !gateways.some(gatewayMatchesConnection)

  const setPrimary = async (gw: Gateway) => {
    await fetch('/api/gateways', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gw.id, is_primary: 1 }),
    })
    fetchGateways()
    fetchHistory()
  }

  const deleteGateway = async (id: number) => {
    await fetch('/api/gateways', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchGateways()
    fetchHistory()
  }

  const connectTo = async (gw: Gateway) => {
    try {
      const res = await fetch('/api/gateways/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gw.id }),
      })
      if (!res.ok) return
      const payload = await res.json()

      const wsUrl = String(payload?.ws_url || buildGatewayWebSocketUrl({
        host: gw.host,
        port: gw.port,
        browserProtocol: window.location.protocol,
      }))
      const token = String(payload?.token || '')
      connect(wsUrl, token)
    } catch {
      // ignore: connection status will remain disconnected
    }
  }

  const probeAll = async () => {
    try {
      const res = await fetch("/api/gateways/health", { method: "POST" })
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
  }

  const probeGateway = async (gw: Gateway) => {
    setProbing(gw.id)
    await probeAll()
    setProbing(null)
  }

  const disconnectCli = async (connectionId: string) => {
    try {
      await fetch('/api/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connectionId }),
      })
      fetchDirectConnections()
    } catch { /* ignore */ }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Gateway Manager</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage multiple OpenClaw gateway connections
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={probeAll}
            variant="secondary"
            size="sm"
          >
            Probe All
          </Button>
          <Button
            onClick={() => setShowAdd(!showAdd)}
            size="sm"
          >
            + Add Gateway
          </Button>
        </div>
      </div>

      {/* Current connection info (shown only for unmanaged/unknown connections). */}
      {shouldShowConnectionSummary && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${connection.isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
            <div>
              <div className="text-sm font-medium text-foreground">
                {connection.isConnected ? 'Connected' : 'Disconnected'}
              </div>
              <div className="text-xs text-muted-foreground">
                {connection.url || 'No active connection'}
                {connection.latency != null && ` (${connection.latency}ms)`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <AddGatewayForm onAdded={() => { fetchGateways(); setShowAdd(false) }} onCancel={() => setShowAdd(false)} />
      )}

      {/* Gateway List */}
      {loading ? (
        <div className="text-center text-xs text-muted-foreground py-8">Loading gateways...</div>
      ) : gateways.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <p className="text-sm text-muted-foreground">No gateways configured</p>
          <p className="text-xs text-muted-foreground mt-1">Add a gateway to start managing connections</p>
        </div>
      ) : (
        <div className="space-y-2">
          {gateways.map(gw => (
            <GatewayCard
              key={gw.id}
              gateway={gw}
              health={healthByGatewayId.get(gw.id)}
              historyEntries={historyByGatewayId[gw.id]?.entries || []}
              isProbing={probing === gw.id}
              isCurrentlyConnected={gatewayMatchesConnection(gw)}
              onSetPrimary={() => setPrimary(gw)}
              onDelete={() => deleteGateway(gw.id)}
              onConnect={() => connectTo(gw)}
              onProbe={() => probeGateway(gw)}
            />
          ))}
        </div>
      )}

      {/* Discovered OS-Level Gateways (exclude already-registered ones) */}
      {discoveredGateways.filter(dg => !gateways.some(gw => gw.port === dg.port)).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Discovered Gateways</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                OpenClaw gateways found on this machine
              </p>
            </div>
            <Button
              onClick={fetchDiscovered}
              variant="secondary"
              size="xs"
              className="text-2xs"
            >
              Refresh
            </Button>
          </div>
          <div className="space-y-2">
            {discoveredGateways
              .filter(dg => !gateways.some(gw => gw.port === dg.port))
              .map(dg => (
                <div key={`${dg.user}-${dg.port}`} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${dg.active ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-sm font-semibold text-foreground">{dg.user}</span>
                        <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${
                          dg.active
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          {dg.active ? 'RUNNING' : 'STOPPED'}
                        </span>
                        {dg.tailscale?.mode && (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium">
                            TS:{dg.tailscale.mode}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                        <span className="font-mono">127.0.0.1:{dg.port}</span>
                        <span>Bind: {dg.bind}</span>
                        <span>Mode: {dg.mode}</span>
                      </div>
                    </div>
                    <Button
                      onClick={async () => {
                        await fetch('/api/gateways', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: dg.user,
                            host: '127.0.0.1',
                            port: dg.port,
                            is_primary: false,
                          }),
                        })
                        fetchGateways()
                        fetchDiscovered()
                      }}
                      variant="secondary"
                      size="xs"
                      className="text-2xs"
                    >
                      Register
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Direct CLI Connections */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Direct CLI Connections</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              CLI tools connected directly without a gateway
            </p>
          </div>
          <Button
            onClick={fetchDirectConnections}
            variant="secondary"
            size="xs"
            className="text-2xs"
          >
            Refresh
          </Button>
        </div>
        {directConnections.length === 0 ? (
          <div className="text-center py-8 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted-foreground">No direct CLI connections</p>
            <p className="text-2xs text-muted-foreground mt-1">
              Use <code className="font-mono bg-secondary px-1 rounded">POST /api/connect</code> to register a CLI tool
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {directConnections.map(conn => (
              <div key={conn.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${conn.status === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-sm font-semibold text-foreground">{conn.agent_name}</span>
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">
                        {conn.tool_name}{conn.tool_version ? ` v${conn.tool_version}` : ''}
                      </span>
                      <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${
                        conn.status === 'connected'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                        {conn.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                      <span>Role: {conn.agent_role || 'cli'}</span>
                      <span>Heartbeat: {conn.last_heartbeat ? new Date(conn.last_heartbeat * 1000).toLocaleString() : 'Never'}</span>
                      <span className="font-mono text-2xs">{conn.connection_id.slice(0, 8)}...</span>
                    </div>
                  </div>
                  {conn.status === 'connected' && (
                    <Button
                      onClick={() => disconnectCli(conn.connection_id)}
                      variant="ghost"
                      size="xs"
                      className="text-2xs text-red-400 hover:bg-red-500/10"
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GatewayCard({ gateway, health, historyEntries = [], isProbing, isCurrentlyConnected, onSetPrimary, onDelete, onConnect, onProbe }: {
  gateway: Gateway
  health?: GatewayHealthProbe
  historyEntries?: GatewayHealthLogEntry[]
  isProbing: boolean
  isCurrentlyConnected: boolean
  onSetPrimary: () => void
  onDelete: () => void
  onConnect: () => void
  onProbe: () => void
}) {
  const statusColors: Record<string, string> = {
    online: 'bg-green-500',
    offline: 'bg-red-500',
    error: 'bg-amber-500',
    timeout: 'bg-amber-500',
    unknown: 'bg-muted-foreground/30',
  }

  const timelineEntries = historyEntries.length > 0 ? [...historyEntries].slice(0, 10).reverse() : []
  const latestEntry = historyEntries[0]

  const lastSeen = gateway.last_seen
    ? new Date(gateway.last_seen * 1000).toLocaleString()
    : 'Never probed'
  const compatibilityWarning = health?.compatibility_warning

  return (
    <div className={`bg-card border rounded-lg p-4 transition-smooth ${
      isCurrentlyConnected ? 'border-green-500/30 bg-green-500/5' : 'border-border'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isCurrentlyConnected ? 'bg-green-500' : (statusColors[gateway.status] || statusColors.unknown)}`} />
            <h3 className="text-sm font-semibold text-foreground">{gateway.name}</h3>
            {gateway.is_primary ? (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 font-medium">
                PRIMARY
              </span>
            ) : null}
            {isCurrentlyConnected && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 font-medium">
                CONNECTED
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
            <span className="font-mono">{gateway.host}:{gateway.port}</span>
            <span>Token: {gateway.token_set ? 'Set' : 'None'}</span>
            {gateway.latency != null && <span>Latency: {gateway.latency}ms</span>}
            <span>Last: {lastSeen}</span>
          </div>
          {health?.gateway_version && (
            <div className="mt-1 text-2xs text-muted-foreground">
              Gateway version: <span className="font-mono text-foreground/80">{health.gateway_version}</span>
            </div>
          )}
          {compatibilityWarning && (
            <div className="mt-1.5 text-2xs rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 px-2 py-1">
              {compatibilityWarning}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3 text-2xs text-muted-foreground">
            {timelineEntries.length > 0 ? (
              <div className="flex items-center gap-0.5">
                {timelineEntries.map((entry) => (
                  <span
                    key={`${entry.probed_at}-${entry.status}`}
                    className={`w-2.5 h-2.5 rounded-full ${statusColors[entry.status] || statusColors.unknown}`}
                    title={`${entry.status} ${entry.latency != null ? `(${entry.latency}ms)` : '(n/a)'} @ ${new Date(entry.probed_at * 1000).toLocaleTimeString()}${entry.error ? ` — ${entry.error}` : ''}`}
                  />
                ))}
              </div>
            ) : (
              <span className="text-2xs text-muted-foreground">No history yet</span>
            )}
            <span title="Green = online; amber = error; red = offline" className="text-2xs text-muted-foreground">
              Color key
            </span>
            {latestEntry?.latency != null && (
              <span className="text-2xs font-medium">Last latency: {latestEntry.latency}ms</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <Button
            onClick={onProbe}
            disabled={isProbing}
            variant="secondary"
            size="xs"
            className="text-2xs"
            title="Probe gateway"
          >
            {isProbing ? 'Probing...' : 'Probe'}
          </Button>
          {!isCurrentlyConnected && (
            <Button
              onClick={onConnect}
              size="xs"
              className="text-2xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
              title="Connect to this gateway"
            >
              Connect
            </Button>
          )}
          {!gateway.is_primary && (
            <>
              <Button
                onClick={onSetPrimary}
                variant="secondary"
                size="xs"
                className="text-2xs"
                title="Set as primary"
              >
                Set Primary
              </Button>
              <Button
                onClick={onDelete}
                variant="ghost"
                size="icon-xs"
                className="hover:text-red-400 hover:bg-red-500/10"
                title="Remove gateway"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 4h10M6 4V3h4v1M5 4v8.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" />
                </svg>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function AddGatewayForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', host: '127.0.0.1', port: '18789', token: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const res = await fetch('/api/gateways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          host: form.host,
          port: parseInt(form.port),
          token: form.token,
          is_primary: false,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add gateway')
        return
      }
      onAdded()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/20 rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Add Gateway</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., primary"
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Host</label>
          <input
            type="text"
            value={form.host}
            onChange={e => setForm({ ...form, host: e.target.value })}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Port</label>
          <input
            type="number"
            value={form.port}
            onChange={e => setForm({ ...form, port: e.target.value })}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Token</label>
          <input
            type="password"
            value={form.token}
            onChange={e => setForm({ ...form, token: e.target.value })}
            placeholder="Optional"
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="button" onClick={onCancel} variant="outline" size="sm">
          Cancel
        </Button>
        <Button type="submit" disabled={saving} size="sm">
          {saving ? 'Adding...' : 'Add Gateway'}
        </Button>
      </div>
    </form>
  )
}
