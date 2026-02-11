'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useWebSocket } from '@/lib/websocket'

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

export function MultiGatewayPanel() {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [probing, setProbing] = useState<number | null>(null)
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

  useEffect(() => { fetchGateways() }, [fetchGateways])

  const setPrimary = async (gw: Gateway) => {
    await fetch('/api/gateways', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gw.id, is_primary: 1 }),
    })
    fetchGateways()
  }

  const deleteGateway = async (id: number) => {
    await fetch('/api/gateways', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchGateways()
  }

  const connectTo = (gw: Gateway) => {
    const wsUrl = `ws://${window.location.hostname}:${gw.port}`
    connect(wsUrl, '') // token is handled by the gateway entry, not passed to frontend
  }

  const probeAll = async () => {
    try {
      await fetch("/api/gateways/health", { method: "POST" })
    } catch { /* ignore */ }
    fetchGateways()
  }

  const probeGateway = async (gw: Gateway) => {
    setProbing(gw.id)
    await probeAll()
    setProbing(null)
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
          <button
            onClick={probeAll}
            className="h-8 px-3 rounded-md text-xs font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-smooth"
          >
            Probe All
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth"
          >
            + Add Gateway
          </button>
        </div>
      </div>

      {/* Current connection info */}
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
              isProbing={probing === gw.id}
              isCurrentlyConnected={connection.url?.includes(`:${gw.port}`) ?? false}
              onSetPrimary={() => setPrimary(gw)}
              onDelete={() => deleteGateway(gw.id)}
              onConnect={() => connectTo(gw)}
              onProbe={() => probeGateway(gw)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GatewayCard({ gateway, isProbing, isCurrentlyConnected, onSetPrimary, onDelete, onConnect, onProbe }: {
  gateway: Gateway
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
    timeout: 'bg-amber-500',
    unknown: 'bg-muted-foreground/30',
  }

  const lastSeen = gateway.last_seen
    ? new Date(gateway.last_seen * 1000).toLocaleString()
    : 'Never probed'

  return (
    <div className={`bg-card border rounded-lg p-4 transition-smooth ${
      isCurrentlyConnected ? 'border-green-500/30 bg-green-500/5' : 'border-border'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColors[gateway.status] || statusColors.unknown}`} />
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
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <button
            onClick={onProbe}
            disabled={isProbing}
            className="h-7 px-2.5 rounded-md text-2xs font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-smooth disabled:opacity-50"
            title="Probe gateway"
          >
            {isProbing ? 'Probing...' : 'Probe'}
          </button>
          {!isCurrentlyConnected && (
            <button
              onClick={onConnect}
              className="h-7 px-2.5 rounded-md text-2xs font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-smooth"
              title="Connect to this gateway"
            >
              Connect
            </button>
          )}
          {!gateway.is_primary && (
            <>
              <button
                onClick={onSetPrimary}
                className="h-7 px-2.5 rounded-md text-2xs font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-smooth"
                title="Set as primary"
              >
                Set Primary
              </button>
              <button
                onClick={onDelete}
                className="w-7 h-7 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-smooth flex items-center justify-center"
                title="Remove gateway"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 4h10M6 4V3h4v1M5 4v8.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" />
                </svg>
              </button>
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
            placeholder="e.g., nefes"
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
        <button type="button" onClick={onCancel} className="h-8 px-4 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-smooth">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="h-8 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth disabled:opacity-50">
          {saving ? 'Adding...' : 'Add Gateway'}
        </button>
      </div>
    </form>
  )
}
