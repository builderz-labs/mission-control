'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

interface PresenceEntry {
  id: string
  clientId: string
  displayName: string
  platform: string
  version: string
  roles: string[]
  connectedAt: number
  lastActivity: number
  host?: string
  ip?: string
  status: 'online' | 'idle' | 'offline'
}

interface PairedDevice {
  id: string
  deviceId: string
  displayName: string
  publicKey: string
  pairedAt: number
  lastSeen?: number
  trusted: boolean
}

type Tab = 'instances' | 'devices'

function relativeTime(ts: number): string {
  if (!ts) return '--'
  const now = Date.now()
  const diffMs = now - (ts < 1e12 ? ts * 1000 : ts)
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function statusColor(status: PresenceEntry['status']): string {
  switch (status) {
    case 'online': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'idle': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'offline': return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

export function NodesPanel() {
  const [tab, setTab] = useState<Tab>('instances')
  const [nodes, setNodes] = useState<PresenceEntry[]>([])
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [connected, setConnected] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNodes = useCallback(async () => {
    try {
      const res = await fetch('/api/nodes')
      if (!res.ok) { setError('Failed to fetch nodes'); return }
      const data = await res.json()
      setNodes(data.nodes || data.entries || [])
      setConnected(data.connected !== false)
      setError(null)
    } catch {
      setError('Failed to fetch nodes')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/nodes?action=devices')
      if (!res.ok) return
      const data = await res.json()
      setDevices(data.devices || [])
    } catch {
      // silent fallback
    }
  }, [])

  useEffect(() => {
    fetchNodes()
    fetchDevices()
    const interval = setInterval(() => {
      fetchNodes()
      fetchDevices()
    }, 30000)
    return () => clearInterval(interval)
  }, [fetchNodes, fetchDevices])

  return (
    <div className="m-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-foreground">Nodes / Instances</h2>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${
            connected
              ? 'bg-green-500/10 text-green-400 border-green-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          }`}
        >
          {connected ? 'Gateway Connected' : 'Gateway Unreachable'}
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4">
        <Button
          variant={tab === 'instances' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setTab('instances')}
        >
          Instances ({nodes.length})
        </Button>
        <Button
          variant={tab === 'devices' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setTab('devices')}
        >
          Devices ({devices.length})
        </Button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading...</div>
      ) : tab === 'instances' ? (
        <InstancesTab nodes={nodes} />
      ) : (
        <DevicesTab devices={devices} />
      )}
    </div>
  )
}

function InstancesTab({ nodes }: { nodes: PresenceEntry[] }) {
  if (nodes.length === 0) {
    return (
      <div className="text-muted-foreground text-sm py-8 text-center">
        No active instances. Nodes appear here when they connect to the gateway.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Name</th>
            <th className="pb-2 pr-4 font-medium">Client ID</th>
            <th className="pb-2 pr-4 font-medium">Platform</th>
            <th className="pb-2 pr-4 font-medium">Version</th>
            <th className="pb-2 pr-4 font-medium">Roles</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 font-medium">Connected</th>
            <th className="pb-2 pr-4 font-medium">Last Activity</th>
            <th className="pb-2 font-medium">Host / IP</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id} className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground font-medium">{node.displayName}</td>
              <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">
                {node.clientId?.slice(0, 12)}...
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{node.platform}</td>
              <td className="py-2 pr-4 text-muted-foreground">{node.version}</td>
              <td className="py-2 pr-4">
                <div className="flex gap-1 flex-wrap">
                  {(node.roles || []).map((role) => (
                    <span
                      key={role}
                      className="px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-2 pr-4">
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${statusColor(node.status)}`}
                >
                  {node.status}
                </span>
              </td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">
                {relativeTime(node.connectedAt)}
              </td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">
                {relativeTime(node.lastActivity)}
              </td>
              <td className="py-2 text-muted-foreground text-xs font-mono">
                {node.host || node.ip || '--'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DevicesTab({ devices }: { devices: PairedDevice[] }) {
  if (devices.length === 0) {
    return (
      <div className="text-muted-foreground text-sm py-8 text-center">
        No paired devices.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Name</th>
            <th className="pb-2 pr-4 font-medium">Device ID</th>
            <th className="pb-2 pr-4 font-medium">Paired At</th>
            <th className="pb-2 pr-4 font-medium">Last Seen</th>
            <th className="pb-2 font-medium">Trusted</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id} className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground font-medium">{device.displayName}</td>
              <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">
                {device.deviceId?.slice(0, 12)}...
              </td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">
                {relativeTime(device.pairedAt)}
              </td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">
                {device.lastSeen ? relativeTime(device.lastSeen) : '--'}
              </td>
              <td className="py-2">
                {device.trusted ? (
                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-green-500/20 text-green-400 border-green-500/30">
                    trusted
                  </span>
                ) : (
                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-zinc-500/20 text-zinc-400 border-zinc-500/30">
                    untrusted
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
