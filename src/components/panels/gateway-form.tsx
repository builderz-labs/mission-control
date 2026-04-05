'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface AddGatewayFormProps {
  readonly onAdded: () => void
  readonly onCancel: () => void
}

interface FormState {
  readonly name: string
  readonly host: string
  readonly port: string
  readonly token: string
}

const INITIAL_FORM: FormState = { name: '', host: '127.0.0.1', port: '18789', token: '' }

export function AddGatewayForm({ onAdded, onCancel }: AddGatewayFormProps): React.ReactElement {
  const t = useTranslations('multiGateway')
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const res = await fetch('/api/gateways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          host: form.host,
          port: parseInt(form.port, 10),
          token: form.token,
          is_primary: false,
        }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('failedToAdd'))
        return
      }
      onAdded()
    } catch {
      setError(t('networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/20 rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{t('addGatewayTitle')}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <FormField label={t('name')} htmlFor="gw-name">
          <input
            id="gw-name"
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder={t('namePlaceholder')}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </FormField>

        <FormField label={t('host')} htmlFor="gw-host">
          <input
            id="gw-host"
            type="text"
            value={form.host}
            onChange={e => setForm({ ...form, host: e.target.value })}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </FormField>

        <FormField label={t('port')} htmlFor="gw-port">
          <input
            id="gw-port"
            type="number"
            value={form.port}
            onChange={e => setForm({ ...form, port: e.target.value })}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </FormField>

        <FormField label={t('token')} htmlFor="gw-token">
          <input
            id="gw-token"
            type="password"
            value={form.token}
            onChange={e => setForm({ ...form, token: e.target.value })}
            placeholder={t('optional')}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </FormField>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="button" onClick={onCancel} variant="outline" size="sm">
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={saving} size="sm">
          {saving ? t('adding') : t('addGatewaySubmit')}
        </Button>
      </div>
    </form>
  )
}

// ── Tiny form-field wrapper to avoid repeating label boilerplate ───────────────

interface FormFieldProps {
  readonly label: string
  readonly htmlFor: string
  readonly children: React.ReactNode
}

function FormField({ label, htmlFor, children }: FormFieldProps): React.ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-2xs text-muted-foreground mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}
