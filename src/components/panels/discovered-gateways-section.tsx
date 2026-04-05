'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Gateway, DiscoveredGateway } from './multi-gateway-panel-types'

interface DiscoveredGatewaysSectionProps {
  readonly discovered: readonly DiscoveredGateway[]
  readonly registered: readonly Gateway[]
  readonly onRefresh: () => void
  readonly onRegister: (dg: DiscoveredGateway) => Promise<void>
}

// Shows OS-level gateways that are not yet registered in the DB.
export function DiscoveredGatewaysSection({
  discovered,
  registered,
  onRefresh,
  onRegister,
}: DiscoveredGatewaysSectionProps): React.ReactElement | null {
  const t = useTranslations('multiGateway')

  const unregistered = discovered.filter(
    dg => !registered.some(gw => gw.port === dg.port),
  )

  if (unregistered.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('discoveredGateways')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('discoveredGatewaysDesc')}</p>
        </div>
        <Button onClick={onRefresh} variant="secondary" size="xs" className="text-2xs">
          {t('refresh')}
        </Button>
      </div>

      <div className="space-y-2">
        {unregistered.map(dg => (
          <DiscoveredGatewayRow key={`${dg.user}-${dg.port}`} dg={dg} onRegister={onRegister} />
        ))}
      </div>
    </div>
  )
}

// ── Single discovered-gateway row ──────────────────────────────────────────────

interface DiscoveredGatewayRowProps {
  readonly dg: DiscoveredGateway
  readonly onRegister: (dg: DiscoveredGateway) => Promise<void>
}

function DiscoveredGatewayRow({ dg, onRegister }: DiscoveredGatewayRowProps): React.ReactElement {
  const t = useTranslations('multiGateway')

  const statusBadgeClass = dg.active
    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
    : 'bg-red-500/20 text-red-400 border border-red-500/30'

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${dg.active ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-semibold text-foreground">{dg.user}</span>
            <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${statusBadgeClass}`}>
              {dg.active ? t('running') : t('stopped')}
            </span>
            {dg.tailscale?.mode && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium">
                TS:{dg.tailscale.mode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
            <span className="font-mono">127.0.0.1:{dg.port}</span>
            <span>{t('bind')}: {dg.bind}</span>
            <span>{t('mode')}: {dg.mode}</span>
          </div>
        </div>
        <Button
          onClick={() => onRegister(dg)}
          variant="secondary"
          size="xs"
          className="text-2xs"
        >
          {t('register')}
        </Button>
      </div>
    </div>
  )
}
