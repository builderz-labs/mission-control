'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Webhook, Delivery } from './webhook-types'
import { formatWebhookTime } from './webhook-types'

// WHY: Each webhook row has an expandable delivery log — this interaction is
//      entirely local to the row, so co-locating the logic here prevents the
//      parent from managing per-row expanded state.

interface DeliveryLogProps {
  readonly deliveries: Delivery[]
}

function DeliveryLog({ deliveries }: DeliveryLogProps): React.ReactElement {
  const t = useTranslations('webhooks')

  if (deliveries.length === 0) {
    return <p className="text-2xs text-muted-foreground">{t('noDeliveries')}</p>
  }

  return (
    <div className="space-y-1 max-h-60 overflow-y-auto">
      {deliveries.map((d) => {
        const isSuccess = d.status_code !== null && d.status_code >= 200 && d.status_code < 300
        return (
          <div key={d.id} className="flex items-center gap-2 text-2xs py-1 px-2 rounded hover:bg-secondary/50">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSuccess ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="font-mono text-muted-foreground w-16 shrink-0">{d.event_type}</span>
            <span className={`font-mono w-8 shrink-0 ${isSuccess ? 'text-green-400' : 'text-red-400'}`}>
              {d.status_code ?? 'ERR'}
            </span>
            <span className="text-muted-foreground font-mono">{d.duration_ms}ms</span>
            {d.error && <span className="text-red-400 truncate">{d.error}</span>}
            <span className="text-muted-foreground/50 ml-auto shrink-0">{formatWebhookTime(d.created_at)}</span>
          </div>
        )
      })}
    </div>
  )
}

interface WebhookListItemProps {
  readonly webhook: Webhook
  readonly isSelected: boolean
  readonly deliveries: Delivery[]
  readonly testingId: number | null
  readonly onSelect: (id: number) => void
  readonly onTest: (id: number) => void
  readonly onToggle: (id: number, enabled: boolean) => void
  readonly onDelete: (id: number) => void
}

export function WebhookListItem({
  webhook: wh,
  isSelected,
  deliveries,
  testingId,
  onSelect,
  onTest,
  onToggle,
  onDelete,
}: WebhookListItemProps): React.ReactElement {
  const t = useTranslations('webhooks')
  const statusIsSuccess = wh.last_status !== null && wh.last_status >= 200 && wh.last_status < 300

  return (
    <div className={`rounded-lg border p-3 transition-smooth ${isSelected ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(wh.id)}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${wh.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
            <span className="text-sm font-medium text-foreground">{wh.name}</span>
            {wh.last_status !== null && (
              <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${statusIsSuccess ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {wh.last_status}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{wh.url}</p>
          <div className="flex items-center gap-3 mt-1.5 text-2xs text-muted-foreground">
            <span>{wh.events.includes('*') ? t('allEvents') : t('eventCount', { count: wh.events.length })}</span>
            <span>{t('deliveries', { count: wh.total_deliveries })}</span>
            {wh.failed_deliveries > 0 && (
              <span className="text-red-400">{t('failed', { count: wh.failed_deliveries })}</span>
            )}
            {wh.last_fired_at && (
              <span>{t('lastFired', { time: formatWebhookTime(wh.last_fired_at) })}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="xs" onClick={() => onTest(wh.id)} disabled={testingId === wh.id} title={t('sendTestEvent')} className="text-2xs">
            {testingId === wh.id ? t('testing') : t('test')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onToggle(wh.id, !wh.enabled)}
            className={`text-2xs ${wh.enabled ? 'text-amber-400 hover:bg-amber-500/10' : 'text-green-400 hover:bg-green-500/10'}`}
          >
            {wh.enabled ? t('disable') : t('enable')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => onDelete(wh.id)} className="text-red-400 hover:bg-red-500/10 text-2xs">
            {t('delete')}
          </Button>
        </div>
      </div>

      {isSelected && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <h4 className="text-xs font-semibold text-foreground">{t('recentDeliveries')}</h4>
          <DeliveryLog deliveries={deliveries} />
        </div>
      )}
    </div>
  )
}
