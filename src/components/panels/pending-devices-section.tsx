'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { deviceAction, relativeTime } from './nodes-panel-utils'
import type { PendingDevice } from './nodes-panel-types'

interface PendingDevicesSectionProps {
  readonly devices: PendingDevice[]
  readonly onRefresh: () => void
}

export function PendingDevicesSection({
  devices,
  onRefresh,
}: PendingDevicesSectionProps): React.ReactElement {
  const t = useTranslations('nodes')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleAction(action: 'approve' | 'reject', requestId: string): Promise<void> {
    setActionError(null)
    setActionLoading(`${action}-${requestId}`)
    const result = await deviceAction(action, { requestId })
    setActionLoading(null)
    if (!result.ok) {
      setActionError(result.error ?? 'Action failed')
    } else {
      onRefresh()
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-amber-400 mb-2">
        {t('pendingPairingRequests', { count: devices.length })}
      </h3>
      {actionError && (
        <div className="mb-2 px-3 py-1.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {actionError}
        </div>
      )}
      <div className="space-y-2">
        {devices.map((device) => (
          <PendingDeviceRow
            key={device.requestId}
            device={device}
            actionLoading={actionLoading}
            onAction={handleAction}
          />
        ))}
      </div>
    </div>
  )
}

interface PendingDeviceRowProps {
  readonly device: PendingDevice
  readonly actionLoading: string | null
  readonly onAction: (action: 'approve' | 'reject', requestId: string) => Promise<void>
}

function PendingDeviceRow({
  device,
  actionLoading,
  onAction,
}: PendingDeviceRowProps): React.ReactElement {
  const t = useTranslations('nodes')
  return (
    <div
      className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20"
    >
      <div className="flex items-center gap-3">
        <div>
          <span className="text-sm font-medium text-foreground">
            {device.displayName ?? device.deviceId}
          </span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{device.deviceId?.slice(0, 16)}</span>
            {device.role && (
              <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                {device.role}
              </span>
            )}
            {device.remoteIp && <span>{device.remoteIp}</span>}
            {device.isRepair && (
              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                repair
              </span>
            )}
            {device.ts && <span>{relativeTime(device.ts)}</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-green-400 hover:text-green-300 hover:bg-green-500/10"
          disabled={actionLoading !== null}
          onClick={() => onAction('approve', device.requestId)}
        >
          {actionLoading === `approve-${device.requestId}` ? t('approving') : t('approve')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          disabled={actionLoading !== null}
          onClick={() => onAction('reject', device.requestId)}
        >
          {actionLoading === `reject-${device.requestId}` ? t('rejecting') : t('reject')}
        </Button>
      </div>
    </div>
  )
}
