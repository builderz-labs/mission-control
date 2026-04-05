'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { AVAILABLE_EVENTS } from './webhook-types'
import type { WebhookCreateForm } from './webhook-types'

// WHY: Form is self-contained with its own local state — extracting it prevents
//      the parent's state from bloating further as form fields grow.

interface CreateWebhookFormProps {
  readonly onSubmit: (form: WebhookCreateForm) => void
  readonly onCancel: () => void
}

export function CreateWebhookForm({ onSubmit, onCancel }: CreateWebhookFormProps): React.ReactElement {
  const t = useTranslations('webhooks')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['*'])

  const toggleEvent = (value: string): void => {
    if (value === '*') {
      setSelectedEvents(['*'])
      return
    }
    setSelectedEvents((prev) => {
      const without = prev.filter((e) => e !== '*' && e !== value)
      if (prev.includes(value)) return without.length === 0 ? ['*'] : without
      return [...without, value]
    })
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{t('newWebhook')}</h3>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">{t('formName')}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Slack alerts"
          className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">{t('formUrl')}</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1.5">{t('formEvents')}</label>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABLE_EVENTS.map((ev) => (
            <Button
              key={ev.value}
              type="button"
              variant={selectedEvents.includes(ev.value) ? 'default' : 'secondary'}
              size="xs"
              onClick={() => toggleEvent(ev.value)}
              title={ev.description}
              className="h-6 text-2xs"
            >
              {ev.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => onSubmit({ name, url, events: selectedEvents })}
          disabled={!name || !url}
          className="flex-1"
        >
          {t('createWebhook')}
        </Button>
      </div>
    </div>
  )
}
