'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

interface ChannelAccount {
  id: string
  platform: string
  label: string
  status: 'connected' | 'disconnected' | 'degraded' | 'pending'
  lastActivity?: number
  messageCount24h?: number
  errorMessage?: string
  probeResult?: { ok: boolean; latencyMs: number; checkedAt: number }
}

interface ChannelsSnapshot {
  channels: ChannelAccount[]
  connected: boolean
  updatedAt?: number
}

const PLATFORM_ICONS: Record<string, string> = {
  whatsapp: '\u{1F4F1}',
  telegram: '\u2708',
  discord: '\u{1F3AE}',
  slack: '#',
  signal: '\u{1F512}',
  imessage: '\u{1F4AC}',
  nostr: '\u{1F310}',
  'google-chat': '\u{1F4E8}',
  'ms-teams': '\u{1F465}',
}

const PLATFORM_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  signal: 'Signal',
  imessage: 'iMessage',
  nostr: 'Nostr',
  'google-chat': 'Google Chat',
  'ms-teams': 'MS Teams',
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  connected: { dot: 'bg-green-500', label: 'Connected' },
  disconnected: { dot: 'bg-red-500', label: 'Disconnected' },
  degraded: { dot: 'bg-amber-500', label: 'Degraded' },
  pending: { dot: 'bg-muted-foreground/50', label: 'Pending' },
}

function relativeTime(ts: number): string {
  const now = Date.now()
  const diff = Math.max(0, now - ts)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ChannelsPanel() {
  const [snapshot, setSnapshot] = useState<ChannelsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/channels')
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
      const res = await fetch(`/api/channels?action=probe&channel=${encodeURIComponent(channelId)}`)
      const data = await res.json()
      if (snapshot) {
        setSnapshot({
          ...snapshot,
          channels: snapshot.channels.map(ch =>
            ch.id === channelId
              ? { ...ch, probeResult: { ok: data.ok, latencyMs: data.latencyMs ?? 0, checkedAt: Date.now() } }
              : ch,
          ),
        })
      }
    } catch {
      // silently fail -- next poll will refresh
    } finally {
      setProbing(null)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="m-4">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading channels...</span>
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

  // Error state
  if (error) {
    return (
      <div className="m-4">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
      </div>
    )
  }

  const channels = snapshot?.channels ?? []
  const gatewayConnected = snapshot?.connected ?? false

  return (
    <div className="m-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Channels</h2>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${gatewayConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-muted-foreground">
              {gatewayConnected ? 'Gateway Connected' : 'Gateway Disconnected'}
            </span>
          </div>
        </div>
        <Button
          onClick={() => { setLoading(true); fetchChannels() }}
          variant="outline"
          size="sm"
        >
          Refresh
        </Button>
      </div>

      {/* Channel cards */}
      {channels.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground">
            No channels configured. Connect messaging platforms through your OpenClaw gateway.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {channels.map(channel => {
            const icon = PLATFORM_ICONS[channel.platform] ?? '\u{1F4E1}'
            const name = PLATFORM_NAMES[channel.platform] ?? channel.platform
            const style = STATUS_STYLES[channel.status] ?? STATUS_STYLES.pending
            const isProbing = probing === channel.id

            return (
              <div key={channel.id} className="rounded-lg border border-border bg-card p-4">
                {/* Platform header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">{icon}</span>
                    <div>
                      <span className="text-sm font-medium text-foreground">{name}</span>
                      {channel.label && channel.label !== name && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{channel.label}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                    <span className="text-xs text-muted-foreground">{style.label}</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                  {channel.lastActivity != null && (
                    <span title="Last activity">
                      {relativeTime(channel.lastActivity)}
                    </span>
                  )}
                  {channel.messageCount24h != null && (
                    <span title="Messages in last 24h">
                      {channel.messageCount24h} msg/24h
                    </span>
                  )}
                </div>

                {/* Error message */}
                {channel.errorMessage && (
                  <p className="text-xs text-red-400 mb-3 break-words">{channel.errorMessage}</p>
                )}

                {/* Probe result */}
                {channel.probeResult && (
                  <div className={`text-xs mb-3 ${channel.probeResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {channel.probeResult.ok
                      ? `Probe OK - ${channel.probeResult.latencyMs}ms`
                      : 'Probe failed'}
                  </div>
                )}

                {/* Probe button */}
                <Button
                  onClick={() => handleProbe(channel.id)}
                  disabled={isProbing}
                  variant="outline"
                  size="xs"
                  className="w-full"
                >
                  {isProbing ? (
                    <>
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Probing...
                    </>
                  ) : (
                    'Probe'
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
