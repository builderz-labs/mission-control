'use client'

// Per-platform channel cards
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CardShell, StatusRow, ErrorCallout, ProbeResult, ProfileField, AccountList } from './shared-components'
import { yesNo, relativeTime, formatDuration, truncatePubkey, readActionResult } from './helpers'
import type { PlatformCardProps, NostrProfile } from './types'

export function WhatsAppCard({ status, accounts, onProbe, probing, onAction, actionBusy }: PlatformCardProps) {
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

export function TelegramCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
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

export function DiscordCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
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

export function SlackCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
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

export function SignalCard({ status, accounts, onProbe, probing }: PlatformCardProps) {
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

export function NostrCard({ status, accounts, onProbe, probing, onAction, actionBusy }: PlatformCardProps) {
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

export function GenericChannelCard({ platform, label, status, accounts, onProbe, probing }: PlatformCardProps & { label?: string }) {
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
