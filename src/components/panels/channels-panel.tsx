'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelStatus {
  configured: boolean
  linked?: boolean
  running: boolean
  connected?: boolean
  lastConnectedAt?: number | null
  lastMessageAt?: number | null
  lastStartAt?: number | null
  lastError?: string | null
  authAgeMs?: number | null
  mode?: string | null
  baseUrl?: string | null
  publicKey?: string | null
  probe?: { ok?: boolean; status?: number; error?: string; elapsedMs?: number; bot?: { username?: string; id?: string }; team?: { id?: string; name?: string }; webhook?: { url?: string }; version?: string }
  profile?: NostrProfile
}

interface ChannelAccount {
  accountId: string
  name?: string | null
  configured?: boolean | null
  linked?: boolean | null
  running?: boolean | null
  connected?: boolean | null
  lastConnectedAt?: number | null
  lastInboundAt?: number | null
  lastOutboundAt?: number | null
  lastError?: string | null
  lastStartAt?: number | null
  mode?: string | null
  probe?: { ok?: boolean; bot?: { username?: string }; [key: string]: unknown }
  publicKey?: string | null
  profile?: NostrProfile
}

interface NostrProfile {
  name?: string | null
  displayName?: string | null
  about?: string | null
  picture?: string | null
  banner?: string | null
  website?: string | null
  nip05?: string | null
  lud16?: string | null
}

interface ChannelsSnapshot {
  channels: Record<string, ChannelStatus>
  channelAccounts: Record<string, ChannelAccount[]>
  channelOrder: string[]
  channelLabels: Record<string, string>
  connected: boolean
  updatedAt?: number
}

type ActionResult = {
  ok?: boolean
  error?: string
  message?: string
  qrDataUrl?: string
  connected?: boolean
  persisted?: boolean
  merged?: NostrProfile
  imported?: NostrProfile
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_ICONS: Record<string, string> = {
  whatsapp: '\u{1F4F1}',
  telegram: '\u2708',
  discord: '\u{1F3AE}',
  slack: '#',
  signal: '\u{1F512}',
  imessage: '\u{1F4AC}',
  nostr: '\u{1F310}',
  'google-chat': '\u{1F4E8}',
  googlechat: '\u{1F4E8}',
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
  googlechat: 'Google Chat',
  'ms-teams': 'MS Teams',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ts: number | null | undefined): string {
  if (ts == null) return 'n/a'
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

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return 'n/a'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function truncatePubkey(pubkey: string | null | undefined): string {
  if (!pubkey) return 'n/a'
  if (pubkey.length <= 20) return pubkey
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`
}

function yesNo(val: boolean | null | undefined): string {
  if (val == null) return 'n/a'
  return val ? 'Yes' : 'No'
}

function channelIsActive(status: ChannelStatus | undefined, accounts: ChannelAccount[]): boolean {
  if (!status) return false
  if (status.configured || status.running || status.connected) return true
  return accounts.some(a => a.configured || a.running || a.connected)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readActionResult(value: unknown): ActionResult | null {
  const record = asRecord(value)
  if (!record) return null

  const readProfile = (candidate: unknown): NostrProfile | undefined => {
    const profile = asRecord(candidate)
    if (!profile) return undefined
    return {
      name: typeof profile.name === 'string' ? profile.name : null,
      displayName: typeof profile.displayName === 'string' ? profile.displayName : null,
      about: typeof profile.about === 'string' ? profile.about : null,
      picture: typeof profile.picture === 'string' ? profile.picture : null,
      banner: typeof profile.banner === 'string' ? profile.banner : null,
      website: typeof profile.website === 'string' ? profile.website : null,
      nip05: typeof profile.nip05 === 'string' ? profile.nip05 : null,
      lud16: typeof profile.lud16 === 'string' ? profile.lud16 : null,
    }
  }

  return {
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    qrDataUrl: typeof record.qrDataUrl === 'string' ? record.qrDataUrl : undefined,
    connected: typeof record.connected === 'boolean' ? record.connected : undefined,
    persisted: typeof record.persisted === 'boolean' ? record.persisted : undefined,
    merged: readProfile(record.merged),
    imported: readProfile(record.imported),
  }
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

function ErrorCallout({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5 mt-2 break-words">
      {message}
    </div>
  )
}

function ProbeResult({ probe }: { probe: ChannelStatus['probe'] }) {
  if (!probe) return null
  return (
    <div className={`text-xs mt-2 px-2 py-1.5 rounded ${probe.ok ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
      Probe {probe.ok ? 'OK' : 'failed'}
      {probe.elapsedMs != null && ` - ${probe.elapsedMs}ms`}
      {probe.error && ` - ${probe.error}`}
    </div>
  )
}

function CardShell({ platform, label, children, status, accounts, onProbe, probing }: {
  platform: string
  label?: string
  children: React.ReactNode
  status?: ChannelStatus
  accounts?: ChannelAccount[]
  onProbe: () => void
  probing: boolean
}) {
  const t = useTranslations('channels')
  const icon = PLATFORM_ICONS[platform] ?? '\u{1F4E1}'
  const name = label || (PLATFORM_NAMES[platform] ?? platform)
  const isActive = channelIsActive(status, accounts ?? [])

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{icon}</span>
          <span className="text-sm font-medium text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isActive ? (status?.connected ? 'bg-green-500' : status?.running ? 'bg-amber-500' : 'bg-muted-foreground/50') : 'bg-red-500'}`} />
          <span className="text-xs text-muted-foreground">
            {isActive ? (status?.connected ? t('statusConnected') : status?.running ? t('statusRunning') : t('statusConfigured')) : t('statusInactive')}
          </span>
        </div>
      </div>
      {children}
      <Button
        onClick={onProbe}
        disabled={probing}
        variant="outline"
        size="xs"
        className="w-full mt-3"
      >
        {probing ? (
          <>
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {t('probing')}
          </>
        ) : t('probe')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-Platform Cards
// ---------------------------------------------------------------------------

function WhatsAppCard({ status, accounts, onProbe, probing, onAction, actionBusy }: PlatformCardProps) {
  const t = useTranslations('channels')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleLink = async (force: boolean) => {
    setMessage(null)
    setQrDataUrl(null)
    const res = readActionResult(await onAction('whatsapp-link', { force }))
    if (res) {
      setMessage(res.message ?? null)
      setQrDataUrl(res.qrDataUrl ?? null)
    }
  }

  const handleWait = async () => {
    setMessage(null)
    const res = readActionResult(await onAction('whatsapp-wait', {}))
    if (res) {
      setMessage(res.message ?? null)
      if (res.connected) setQrDataUrl(null)
    }
  }

  const handleLogout = async () => {
    setMessage(null)
    setQrDataUrl(null)
    await onAction('whatsapp-logout', {})
    setMessage(t('loggedOut'))
  }

  return (
    <CardShell platform="whatsapp" status={status} accounts={accounts} onProbe={onProbe} probing={probing}>
      <div className="space-y-0.5">
        <StatusRow label="Configured" value={yesNo(status?.configured)} />
        <StatusRow label="Linked" value={yesNo(status?.linked)} />
        <StatusRow label="Running" value={yesNo(status?.running)} />
        <StatusRow label="Connected" value={yesNo(status?.connected)} />
        <StatusRow label="Last connect" value={relativeTime(status?.lastConnectedAt)} />
        <StatusRow label="Last message" value={relativeTime(status?.lastMessageAt)} />
        <StatusRow label="Auth age" value={formatDuration(status?.authAgeMs)} />
      </div>

      <ErrorCallout message={status?.lastError} />

      {message && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 mt-2">
          {message}
        </div>
      )}

      {qrDataUrl && (
        <div className="flex justify-center mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="WhatsApp QR" className="w-48 h-48 rounded" />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-3">
        <Button onClick={() => handleLink(false)} disabled={actionBusy} variant="outline" size="xs">
          {t('showQr')}
        </Button>
        <Button onClick={() => handleLink(true)} disabled={actionBusy} variant="outline" size="xs">
          {t('relink')}
        </Button>
        <Button onClick={handleWait} disabled={actionBusy} variant="outline" size="xs">
          {t('waitForScan')}
        </Button>
        <Button onClick={handleLogout} disabled={actionBusy} variant="destructive" size="xs">
          {t('logout')}
        </Button>
      </div>

      {accounts.length > 0 && <AccountList accounts={accounts} />}
    </CardShell>
  )
}

function TelegramCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
  const botUsername = status?.probe?.bot?.username

  return (
    <CardShell platform="telegram" status={status} accounts={accounts} onProbe={onProbe} probing={probing}>
      <div className="space-y-0.5">
        <StatusRow label="Configured" value={yesNo(status?.configured)} />
        <StatusRow label="Running" value={yesNo(status?.running)} />
        <StatusRow label="Mode" value={status?.mode ?? 'n/a'} />
        {botUsername && <StatusRow label="Bot" value={`@${botUsername}`} />}
        <StatusRow label="Last start" value={relativeTime(status?.lastStartAt)} />
      </div>
      <ErrorCallout message={status?.lastError} />
      <ProbeResult probe={status?.probe} />
      {accounts.length > 1 && <AccountList accounts={accounts} />}
    </CardShell>
  )
}

function DiscordCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
  const botUsername = status?.probe?.bot?.username

  return (
    <CardShell platform="discord" status={status} accounts={accounts} onProbe={onProbe} probing={probing}>
      <div className="space-y-0.5">
        <StatusRow label="Configured" value={yesNo(status?.configured)} />
        <StatusRow label="Running" value={yesNo(status?.running)} />
        {botUsername && <StatusRow label="Bot" value={botUsername} />}
        <StatusRow label="Last start" value={relativeTime(status?.lastStartAt)} />
      </div>
      <ErrorCallout message={status?.lastError} />
      <ProbeResult probe={status?.probe} />
      {accounts.length > 1 && <AccountList accounts={accounts} />}
    </CardShell>
  )
}

function SlackCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
  const teamName = status?.probe?.team?.name
  const botName = status?.probe?.bot?.username

  return (
    <CardShell platform="slack" status={status} accounts={accounts} onProbe={onProbe} probing={probing}>
      <div className="space-y-0.5">
        <StatusRow label="Configured" value={yesNo(status?.configured)} />
        <StatusRow label="Running" value={yesNo(status?.running)} />
        {teamName && <StatusRow label="Workspace" value={teamName} />}
        {botName && <StatusRow label="Bot" value={botName} />}
        <StatusRow label="Last start" value={relativeTime(status?.lastStartAt)} />
      </div>
      <ErrorCallout message={status?.lastError} />
      <ProbeResult probe={status?.probe} />
      {accounts.length > 1 && <AccountList accounts={accounts} />}
    </CardShell>
  )
}

function SignalCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
  return (
    <CardShell platform="signal" status={status} accounts={accounts} onProbe={onProbe} probing={probing}>
      <div className="space-y-0.5">
        <StatusRow label="Configured" value={yesNo(status?.configured)} />
        <StatusRow label="Running" value={yesNo(status?.running)} />
        <StatusRow label="Base URL" value={status?.baseUrl ?? 'n/a'} />
        <StatusRow label="Last start" value={relativeTime(status?.lastStartAt)} />
      </div>
      <ErrorCallout message={status?.lastError} />
      <ProbeResult probe={status?.probe} />
      {accounts.length > 1 && <AccountList accounts={accounts} />}
    </CardShell>
  )
}

function NostrCard({ status, accounts, onProbe, probing, onAction, actionBusy }: PlatformCardProps) {
  const t = useTranslations('channels')
  const primaryAccount = accounts[0]
  const profile: NostrProfile | null = primaryAccount?.profile ?? status?.profile ?? null
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState<NostrProfile>({})
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const openProfileForm = () => {
    setProfileForm({
      name: profile?.name ?? '',
      displayName: profile?.displayName ?? '',
      about: profile?.about ?? '',
      picture: profile?.picture ?? '',
      banner: profile?.banner ?? '',
      website: profile?.website ?? '',
      nip05: profile?.nip05 ?? '',
      lud16: profile?.lud16 ?? '',
    })
    setShowAdvanced(Boolean(profile?.banner || profile?.website || profile?.nip05 || profile?.lud16))
    setProfileMessage(null)
    setEditingProfile(true)
  }

  const handleProfileSave = async () => {
    setProfileSaving(true)
    setProfileMessage(null)
    const accountId = primaryAccount?.accountId ?? 'default'
    const res = readActionResult(await onAction('nostr-profile-save', { accountId, profile: profileForm }))
    setProfileSaving(false)
    if (res?.ok !== false && res?.persisted) {
      setProfileMessage(t('profilePublished'))
      setEditingProfile(false)
    } else {
      setProfileMessage(res?.error ?? t('saveFailed'))
    }
  }

  const handleProfileImport = async () => {
    setProfileSaving(true)
    setProfileMessage(null)
    const accountId = primaryAccount?.accountId ?? 'default'
    const res = readActionResult(await onAction('nostr-profile-import', { accountId }))
    setProfileSaving(false)
    if (res?.merged || res?.imported) {
      const merged = res.merged ?? res.imported
      setProfileForm(prev => ({ ...prev, ...merged }))
      setProfileMessage(t('profileImported'))
    } else {
      setProfileMessage(res?.error ?? t('importFailed'))
    }
  }

  return (
    <CardShell platform="nostr" status={status} accounts={accounts} onProbe={onProbe} probing={probing}>
      <div className="space-y-0.5">
        <StatusRow label="Configured" value={yesNo(status?.configured)} />
        <StatusRow label="Running" value={yesNo(status?.running)} />
        <StatusRow label="Public Key" value={truncatePubkey(status?.publicKey ?? primaryAccount?.publicKey)} />
        <StatusRow label="Last start" value={relativeTime(status?.lastStartAt)} />
      </div>
      <ErrorCallout message={status?.lastError} />

      {/* Profile Section */}
      {!editingProfile ? (
        <div className="mt-3 p-2.5 bg-muted/30 rounded text-xs">
          <div className="flex justify-between items-center mb-1.5">
            <span className="font-medium text-foreground">{t('profile')}</span>
            {status?.configured && (
              <Button onClick={openProfileForm} variant="ghost" size="xs" className="h-5 text-[10px] px-1.5">
                {t('edit')}
              </Button>
            )}
          </div>
          {profile?.displayName || profile?.name ? (
            <div className="space-y-0.5">
              {profile.displayName && <StatusRow label={t('displayName')} value={profile.displayName} />}
              {profile.name && <StatusRow label={t('username')} value={profile.name} />}
              {profile.about && <StatusRow label={t('about')} value={profile.about.slice(0, 80)} />}
              {profile.nip05 && <StatusRow label="NIP-05" value={profile.nip05} />}
            </div>
          ) : (
            <span className="text-muted-foreground">{t('noProfileSet')}</span>
          )}
        </div>
      ) : (
        <div className="mt-3 p-2.5 bg-muted/30 rounded text-xs space-y-2">
          <div className="font-medium text-foreground">{t('editProfile')}</div>
          {profileMessage && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">{profileMessage}</div>
          )}
          <ProfileField label={t('username')} value={profileForm.name ?? ''} onChange={v => setProfileForm(p => ({ ...p, name: v }))} disabled={profileSaving} />
          <ProfileField label={t('displayName')} value={profileForm.displayName ?? ''} onChange={v => setProfileForm(p => ({ ...p, displayName: v }))} disabled={profileSaving} />
          <ProfileField label={t('bio')} value={profileForm.about ?? ''} onChange={v => setProfileForm(p => ({ ...p, about: v }))} disabled={profileSaving} multiline />
          <ProfileField label={t('avatarUrl')} value={profileForm.picture ?? ''} onChange={v => setProfileForm(p => ({ ...p, picture: v }))} disabled={profileSaving} />
          {showAdvanced && (
            <>
              <ProfileField label={t('bannerUrl')} value={profileForm.banner ?? ''} onChange={v => setProfileForm(p => ({ ...p, banner: v }))} disabled={profileSaving} />
              <ProfileField label={t('website')} value={profileForm.website ?? ''} onChange={v => setProfileForm(p => ({ ...p, website: v }))} disabled={profileSaving} />
              <ProfileField label="NIP-05" value={profileForm.nip05 ?? ''} onChange={v => setProfileForm(p => ({ ...p, nip05: v }))} disabled={profileSaving} />
              <ProfileField label={t('lightning')} value={profileForm.lud16 ?? ''} onChange={v => setProfileForm(p => ({ ...p, lud16: v }))} disabled={profileSaving} />
            </>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={handleProfileSave} disabled={profileSaving || actionBusy} variant="default" size="xs">
              {profileSaving ? t('saving') : t('saveAndPublish')}
            </Button>
            <Button onClick={handleProfileImport} disabled={profileSaving || actionBusy} variant="outline" size="xs">
              {t('importFromRelays')}
            </Button>
            <Button onClick={() => setShowAdvanced(!showAdvanced)} variant="outline" size="xs">
              {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
            </Button>
            <Button onClick={() => setEditingProfile(false)} disabled={profileSaving} variant="ghost" size="xs">
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {accounts.length > 1 && <AccountList accounts={accounts} />}
    </CardShell>
  )
}

function GenericChannelCard({ platform, label, status, accounts, onProbe, probing }: PlatformCardProps & { label?: string }) {
  return (
    <CardShell platform={platform} label={label} status={status} accounts={accounts} onProbe={onProbe} probing={probing}>
      <div className="space-y-0.5">
        <StatusRow label="Configured" value={yesNo(status?.configured)} />
        <StatusRow label="Running" value={yesNo(status?.running)} />
        <StatusRow label="Connected" value={yesNo(status?.connected)} />
        <StatusRow label="Last start" value={relativeTime(status?.lastStartAt)} />
      </div>
      <ErrorCallout message={status?.lastError} />
      <ProbeResult probe={status?.probe} />
      {accounts.length > 0 && <AccountList accounts={accounts} />}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Shared sub-components (continued)
// ---------------------------------------------------------------------------

function ProfileField({ label, value, onChange, disabled, multiline }: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean; multiline?: boolean
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground mb-0.5 block">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          rows={2}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground resize-y"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground"
        />
      )}
    </div>
  )
}

function AccountList({ accounts }: { accounts: ChannelAccount[] }) {
  const t = useTranslations('channels')
  return (
    <div className="mt-3 space-y-2">
      <div className="text-[10px] text-muted-foreground font-medium">
        {t('accounts', { count: accounts.length })}
      </div>
      {accounts.map(acct => (
        <div key={acct.accountId} className="p-2 bg-muted/20 rounded text-xs space-y-0.5">
          <div className="flex justify-between">
            <span className="font-medium text-foreground">{acct.name || acct.accountId}</span>
            <span className="text-muted-foreground text-[10px]">{acct.accountId}</span>
          </div>
          <StatusRow label="Running" value={yesNo(acct.running)} />
          <StatusRow label="Configured" value={yesNo(acct.configured)} />
          <StatusRow label="Connected" value={yesNo(acct.connected)} />
          {acct.lastInboundAt && <StatusRow label="Last inbound" value={relativeTime(acct.lastInboundAt)} />}
          {acct.lastError && (
            <div className="text-red-400 break-words mt-1">{acct.lastError}</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card Props
// ---------------------------------------------------------------------------

interface PlatformCardProps {
  platform: string
  status?: ChannelStatus
  accounts: ChannelAccount[]
  onProbe: () => void
  probing: boolean
  onAction: (action: string, params: Record<string, unknown>) => Promise<unknown>
  actionBusy: boolean
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

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
      await fetch(`/api/channels?action=probe&channel=${encodeURIComponent(channelId)}`)
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

  // Loading state
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

  // Error state
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
    const status = channels[key]
    const accounts = channelAccounts[key] ?? []
    const label = channelLabels[key]
    const isPlatformProbing = probing === key

    const cardProps: PlatformCardProps = {
      platform: key,
      status,
      accounts,
      onProbe: () => handleProbe(key),
      probing: isPlatformProbing,
      onAction: handleAction,
      actionBusy,
    }

    switch (key) {
      case 'whatsapp':
        return <WhatsAppCard key={key} {...cardProps} />
      case 'telegram':
        return <TelegramCard key={key} {...cardProps} />
      case 'discord':
        return <DiscordCard key={key} {...cardProps} />
      case 'slack':
        return <SlackCard key={key} {...cardProps} />
      case 'signal':
        return <SignalCard key={key} {...cardProps} />
      case 'nostr':
        return <NostrCard key={key} {...cardProps} />
      default:
        return <GenericChannelCard key={key} {...cardProps} label={label} />
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
            {gatewayConnected
              ? t('noChannelsConfigured')
              : t('gatewayUnreachable')}
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
