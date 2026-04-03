'use client'

// Shared atomic sub-components used across platform cards
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PLATFORM_ICONS, PLATFORM_NAMES } from './constants'
import { channelIsActive, yesNo, relativeTime } from './helpers'
import type { ChannelStatus, ChannelAccount } from './types'

export function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

export function ErrorCallout({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5 mt-2 break-words">
      {message}
    </div>
  )
}

export function ProbeResult({ probe }: { probe: ChannelStatus['probe'] }) {
  if (!probe) return null
  return (
    <div className={`text-xs mt-2 px-2 py-1.5 rounded ${probe.ok ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
      Probe {probe.ok ? 'OK' : 'failed'}
      {probe.elapsedMs != null && ` - ${probe.elapsedMs}ms`}
      {probe.error && ` - ${probe.error}`}
    </div>
  )
}

export function CardShell({ platform, label, children, status, accounts, onProbe, probing }: {
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

export function ProfileField({ label, value, onChange, disabled, multiline }: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
  multiline?: boolean
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

export function AccountList({ accounts }: { accounts: ChannelAccount[] }) {
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
