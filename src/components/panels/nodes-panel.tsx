'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { InstancesTab } from './instances-tab'
import { DevicesTab } from './devices-tab'
import type { PresenceEntry, PairedDevice, PendingDevice, Tab } from './nodes-panel-types'

export function NodesPanel(): React.ReactElement {
  const t = useTranslations('nodes')
  const [tab, setTab] = useState<Tab>('instances')
  const [nodes, setNodes] = useState<PresenceEntry[]>([])
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([])
  const [connected, setConnected] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNodes = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/nodes', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) { setError('Failed to fetch nodes'); return }
      const data = await res.json() as { nodes?: PresenceEntry[]; entries?: PresenceEntry[]; connected?: boolean }
      setNodes(data.nodes ?? data.entries ?? [])
      setConnected(data.connected !== false)
      setError(null)
    } catch {
      setError('Failed to fetch nodes')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDevices = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/nodes?action=devices', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const data = await res.json() as { paired?: PairedDevice[]; devices?: PairedDevice[]; pending?: PendingDevice[] }
      setDevices(data.paired ?? data.devices ?? [])
      setPendingDevices(data.pending ?? [])
    } catch {
      // silent fallback — connectivity may be intermittent
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

  const pendingCount = pendingDevices.length
  const totalDeviceCount = devices.length + pendingCount

  return (
    <div className="m-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${
            connected
              ? 'bg-green-500/10 text-green-400 border-green-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          }`}
        >
          {connected ? t('gatewayConnected') : t('gatewayUnreachable')}
        </span>
      </div>

      <div className="flex gap-1 mb-4">
        <Button
          variant={tab === 'instances' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setTab('instances')}
        >
          {t('tabInstances', { count: nodes.length })}
        </Button>
        <Button
          variant={tab === 'devices' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setTab('devices')}
        >
          {t('tabDevices', { count: totalDeviceCount })}
          {pendingCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {pendingCount}
            </span>
          )}
        </Button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">{t('loading')}</div>
      ) : tab === 'instances' ? (
        <InstancesTab nodes={nodes} />
      ) : (
        <DevicesTab
          devices={devices}
          pendingDevices={pendingDevices}
          onRefresh={fetchDevices}
        />
      )}
    </div>
  )
}
