'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { deviceAction, relativeTime } from './nodes-panel-utils'
import type { PairedDevice, DeviceTokenSummary } from './nodes-panel-types'

interface PairedDevicesSectionProps {
  readonly devices: PairedDevice[]
  readonly onRefresh: () => void
}

export function PairedDevicesSection({
  devices,
  onRefresh,
}: PairedDevicesSectionProps): React.ReactElement {
  const t = useTranslations('nodes')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null)

  async function handleRotateToken(deviceId: string, role?: string): Promise<void> {
    setActionError(null)
    setActionLoading(`rotate-${deviceId}`)
    const result = await deviceAction('rotate-token', { deviceId, role })
    setActionLoading(null)
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to rotate token')
    } else {
      onRefresh()
    }
  }

  async function handleRevokeToken(deviceId: string, role?: string): Promise<void> {
    setActionError(null)
    setActionLoading(`revoke-${deviceId}`)
    const result = await deviceAction('revoke-token', { deviceId, role })
    setActionLoading(null)
    setConfirmRevoke(null)
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to revoke token')
    } else {
      onRefresh()
    }
  }

  if (devices.length === 0) {
    return (
      <div className="text-muted-foreground text-sm py-8 text-center">
        {t('noPairedDevices')}
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        {t('pairedDevices', { count: devices.length })}
      </h3>
      {actionError && (
        <div className="mb-2 px-3 py-1.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {actionError}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">{t('colName')}</th>
              <th className="pb-2 pr-4 font-medium">{t('colDeviceId')}</th>
              <th className="pb-2 pr-4 font-medium">{t('colRoles')}</th>
              <th className="pb-2 pr-4 font-medium">{t('colPaired')}</th>
              <th className="pb-2 pr-4 font-medium">{t('colLastSeen')}</th>
              <th className="pb-2 pr-4 font-medium">{t('colTrust')}</th>
              <th className="pb-2 font-medium">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const deviceKey = device.deviceId || device.id
              return (
                <PairedDeviceRow
                  key={device.id || device.deviceId}
                  device={device}
                  deviceKey={deviceKey}
                  isExpanded={expandedDevice === deviceKey}
                  confirmRevoke={confirmRevoke}
                  actionLoading={actionLoading}
                  onRotate={handleRotateToken}
                  onRevoke={handleRevokeToken}
                  onSetConfirmRevoke={setConfirmRevoke}
                  onToggleExpand={() =>
                    setExpandedDevice(expandedDevice === deviceKey ? null : deviceKey)
                  }
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface PairedDeviceRowProps {
  readonly device: PairedDevice
  readonly deviceKey: string
  readonly isExpanded: boolean
  readonly confirmRevoke: string | null
  readonly actionLoading: string | null
  readonly onRotate: (deviceId: string, role?: string) => Promise<void>
  readonly onRevoke: (deviceId: string, role?: string) => Promise<void>
  readonly onSetConfirmRevoke: (id: string | null) => void
  readonly onToggleExpand: () => void
}

function PairedDeviceRow({
  device,
  deviceKey,
  isExpanded,
  confirmRevoke,
  actionLoading,
  onRotate,
  onRevoke,
  onSetConfirmRevoke,
  onToggleExpand,
}: PairedDeviceRowProps): React.ReactElement {
  const t = useTranslations('nodes')
  const tokens = device.tokens ?? []

  return (
    <tr className="border-b border-border/50 align-top">
      <td className="py-2 pr-4 text-foreground font-medium">{device.displayName}</td>
      <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">
        {(device.deviceId || device.id)?.slice(0, 12)}...
      </td>
      <td className="py-2 pr-4">
        <div className="flex gap-1 flex-wrap">
          {(device.roles ?? []).map((role) => (
            <span
              key={role}
              className="px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground"
            >
              {role}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2 pr-4 text-muted-foreground text-xs">
        {relativeTime(device.pairedAt ?? device.approvedAtMs ?? device.createdAtMs ?? 0)}
      </td>
      <td className="py-2 pr-4 text-muted-foreground text-xs">
        {device.lastSeen ? relativeTime(device.lastSeen) : '--'}
      </td>
      <td className="py-2 pr-4">
        {device.trusted ? (
          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-green-500/20 text-green-400 border-green-500/30">
            {t('trusted')}
          </span>
        ) : (
          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-zinc-500/20 text-zinc-400 border-zinc-500/30">
            {t('untrusted')}
          </span>
        )}
      </td>
      <td className="py-2">
        <DeviceActions
          deviceKey={deviceKey}
          tokens={tokens}
          isExpanded={isExpanded}
          confirmRevoke={confirmRevoke}
          actionLoading={actionLoading}
          onRotate={onRotate}
          onRevoke={onRevoke}
          onSetConfirmRevoke={onSetConfirmRevoke}
          onToggleExpand={onToggleExpand}
        />
      </td>
    </tr>
  )
}

interface DeviceActionsProps {
  readonly deviceKey: string
  readonly tokens: DeviceTokenSummary[]
  readonly isExpanded: boolean
  readonly confirmRevoke: string | null
  readonly actionLoading: string | null
  readonly onRotate: (deviceId: string, role?: string) => Promise<void>
  readonly onRevoke: (deviceId: string, role?: string) => Promise<void>
  readonly onSetConfirmRevoke: (id: string | null) => void
  readonly onToggleExpand: () => void
}

function DeviceActions({
  deviceKey,
  tokens,
  isExpanded,
  confirmRevoke,
  actionLoading,
  onRotate,
  onRevoke,
  onSetConfirmRevoke,
  onToggleExpand,
}: DeviceActionsProps): React.ReactElement {
  const t = useTranslations('nodes')
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={actionLoading !== null}
          onClick={() => onRotate(deviceKey)}
        >
          {actionLoading === `rotate-${deviceKey}` ? '...' : t('rotateToken')}
        </Button>
        {confirmRevoke === deviceKey ? (
          <div className="flex gap-1 items-center">
            <span className="text-xs text-red-400">{t('revokeConfirm')}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-red-400 hover:bg-red-500/10"
              disabled={actionLoading !== null}
              onClick={() => onRevoke(deviceKey)}
            >
              {actionLoading === `revoke-${deviceKey}` ? '...' : t('yes')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onSetConfirmRevoke(null)}
            >
              {t('no')}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-red-400 hover:bg-red-500/10"
            disabled={actionLoading !== null}
            onClick={() => onSetConfirmRevoke(deviceKey)}
          >
            {t('revoke')}
          </Button>
        )}
        {tokens.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onToggleExpand}
          >
            {isExpanded ? t('hideTokens') : t('tokens', { count: tokens.length })}
          </Button>
        )}
      </div>
      {isExpanded && tokens.length > 0 && (
        <TokenList
          tokens={tokens}
          deviceKey={deviceKey}
          actionLoading={actionLoading}
          onRotate={onRotate}
          onRevoke={onRevoke}
        />
      )}
    </div>
  )
}

interface TokenListProps {
  readonly tokens: DeviceTokenSummary[]
  readonly deviceKey: string
  readonly actionLoading: string | null
  readonly onRotate: (deviceId: string, role?: string) => Promise<void>
  readonly onRevoke: (deviceId: string, role?: string) => Promise<void>
}

function TokenList({
  tokens,
  deviceKey,
  actionLoading,
  onRotate,
  onRevoke,
}: TokenListProps): React.ReactElement {
  const t = useTranslations('nodes')
  return (
    <div className="mt-1 space-y-1">
      {tokens.map((token, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2 py-1 rounded bg-secondary/50 text-xs"
        >
          <span className="font-medium text-foreground">{token.role}</span>
          {token.scopes && token.scopes.length > 0 && (
            <span className="text-muted-foreground">[{token.scopes.join(', ')}]</span>
          )}
          {token.lastUsedAtMs && (
            <span className="text-muted-foreground">
              {t('tokenUsed', { time: relativeTime(token.lastUsedAtMs) })}
            </span>
          )}
          {token.revokedAtMs && (
            <span className="text-red-400">{t('revoked')}</span>
          )}
          <div className="flex gap-1 ml-auto">
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px]"
              disabled={actionLoading !== null}
              onClick={() => onRotate(deviceKey, token.role)}
            >
              {t('rotate')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px] text-red-400 hover:bg-red-500/10"
              disabled={actionLoading !== null || !!token.revokedAtMs}
              onClick={() => onRevoke(deviceKey, token.role)}
            >
              {t('revoke')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
