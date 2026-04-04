'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/types/sql'
import type { Agent, ChannelAccountInfo, ChannelEntryInfo } from './agent-detail-types'

const log = createClientLogger('ChannelsTab')

interface ChannelsTabProps {
  agent: Agent
}

export function ChannelsTab({ agent }: ChannelsTabProps) {
  const t = useTranslations('agentDetail')
  const [channels, setChannels] = useState<ChannelEntryInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadChannels = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/channels', { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('Failed to load channels')
      const data = await response.json()

      const snapshot = data.channels || data
      const channelOrder: string[] = snapshot.channelOrder || []
      const channelMeta: Array<{ id: string; label?: string }> = snapshot.channelMeta || []
      const channelAccounts: Record<string, ChannelAccountInfo[]> = snapshot.channelAccounts || {}
      const channelLabels: Record<string, string> = snapshot.channelLabels || {}

      const ids = new Set<string>()
      for (const id of channelOrder) ids.add(id)
      for (const entry of channelMeta) ids.add(entry.id)
      for (const id of Object.keys(channelAccounts)) ids.add(id)

      const entries: ChannelEntryInfo[] = Array.from(ids).map(id => {
        const meta = channelMeta.find(m => m.id === id)
        return {
          id,
          label: meta?.label || channelLabels[id] || id,
          accounts: channelAccounts[id] || [],
        }
      })

      setChannels(entries)
    } catch (err: unknown) {
      log.error('Failed to load channels:', err)
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Re-fetch whenever the viewed agent changes
  useEffect(() => { loadChannels() }, [agent.id])

  if (loading && channels.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label="Loading channels" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('channelStatus')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('channelStatusDesc', { agent: agent.name })}
          </p>
        </div>
        <Button onClick={loadChannels} size="sm" variant="secondary" disabled={loading}>
          {loading ? '...' : t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {channels.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">
          {t('noChannelsFound')}
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map(channel => {
            const total = channel.accounts.length
            const connected = channel.accounts.filter(a => {
              const probeOk = a.probe && typeof a.probe === 'object' && 'ok' in a.probe ? Boolean(a.probe.ok) : false
              return a.connected === true || a.running === true || probeOk
            }).length
            const enabled = channel.accounts.filter(a => a.enabled).length
            const configured = channel.accounts.filter(a => a.configured).length

            return (
              <div key={channel.id} className="bg-surface-1/50 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{channel.label}</div>
                  <div className="text-xs font-mono text-muted-foreground">{channel.id}</div>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{total > 0 ? t('connectedOf', { connected, total }) : t('noAccounts')}</span>
                  <span>{configured > 0 ? t('configuredCount', { count: configured }) : t('notConfigured')}</span>
                  <span className={enabled > 0 ? 'text-green-400' : ''}>{total > 0 ? t('enabledCount', { count: enabled }) : t('disabled')}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
