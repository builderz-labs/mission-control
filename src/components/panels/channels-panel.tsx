'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import type { ChannelsSnapshot, PlatformCardProps } from './channels/types'
import { channelIsActive } from './channels/helpers'
import {
  WhatsAppCard, TelegramCard, DiscordCard, SlackCard,
  SignalCard, NostrCard, GenericChannelCard,
} from './channels/platform-cards'

export function ChannelsPanel() {
  const t = useTranslations('channels')
  const { connection } = useMissionControl()
  const [snapshot, setSnapshot] = useState<ChannelsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/channels', { signal: AbortSignal.timeout(8000) })
      if (res.status === 401 || res.status === 403) {
        setError('Authentication required')
        return
      }
      if (!res.ok) {
        setError('Failed to load channels')
        return
      }
      const data: ChannelsSnapshot = await res.json()
      setSnapshot(data)
      setError(null)
    } catch {
      setError('Failed to load channels')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchChannels()
    const interval = setInterval(fetchChannels, 30000)
    return () => clearInterval(interval)
  }, [fetchChannels])

  const handleProbe = async (channelId: string) => {
    setProbing(channelId)
    try {
      await fetch(`/api/channels?action=probe&channel=${encodeURIComponent(channelId)}`, { signal: AbortSignal.timeout(8000) })
      await fetchChannels()
    } catch {
      // next poll will refresh
    } finally {
      setProbing(null)
    }
  }

  const handleAction = async (action: string, params: Record<string, unknown>): Promise<unknown> => {
    setActionBusy(true)
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      // Refresh channel data after action
      await fetchChannels()
      return data
    } catch {
      return null
    } finally {
      setActionBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="m-4">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">{t('loadingChannels')}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-1/2 mb-3" />
              <div className="h-3 bg-muted rounded w-1/3 mb-2" />
              <div className="h-3 bg-muted rounded w-1/4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-4">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
      </div>
    )
  }

  const channelOrder = snapshot?.channelOrder ?? []
  const channels = snapshot?.channels ?? {}
  const channelAccounts = snapshot?.channelAccounts ?? {}
  const channelLabels = snapshot?.channelLabels ?? {}
  const gatewayConnected = snapshot?.connected ?? connection.isConnected

  // Sort: active/connected first, then by original order
  const sortedOrder = [...channelOrder].sort((a, b) => {
    const aActive = channelIsActive(channels[a], channelAccounts[a] ?? [])
    const bActive = channelIsActive(channels[b], channelAccounts[b] ?? [])
    if (aActive !== bActive) return aActive ? -1 : 1
    return 0
  })

  const renderCard = (key: string) => {
    const cardProps: PlatformCardProps = {
      platform: key,
      status: channels[key],
      accounts: channelAccounts[key] ?? [],
      onProbe: () => handleProbe(key),
      probing: probing === key,
      onAction: handleAction,
      actionBusy,
    }

    switch (key) {
      case 'whatsapp': return <WhatsAppCard key={key} {...cardProps} />
      case 'telegram': return <TelegramCard key={key} {...cardProps} />
      case 'discord':  return <DiscordCard  key={key} {...cardProps} />
      case 'slack':    return <SlackCard    key={key} {...cardProps} />
      case 'signal':   return <SignalCard   key={key} {...cardProps} />
      case 'nostr':    return <NostrCard    key={key} {...cardProps} />
      default:         return <GenericChannelCard key={key} {...cardProps} label={channelLabels[key]} />
    }
  }

  return (
    <div className="m-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${gatewayConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-muted-foreground">
              {gatewayConnected ? t('gatewayConnected') : t('gatewayDisconnected')}
            </span>
          </div>
        </div>
        <Button
          onClick={() => { setLoading(true); fetchChannels() }}
          variant="outline"
          size="sm"
        >
          {t('refresh')}
        </Button>
      </div>

      {/* Channel cards */}
      {sortedOrder.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground">
            {gatewayConnected ? t('noChannelsConfigured') : t('gatewayUnreachable')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedOrder.map(key => renderCard(key))}
        </div>
      )}
    </div>
  )
}
