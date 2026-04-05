'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type CreateRuleFormState, ENTITY_FIELDS, OPERATORS } from './types'

interface CreateRuleFormProps {
  onCreated: () => void
  onCancel: () => void
}

const DEFAULT_FORM: CreateRuleFormState = {
  name: '',
  description: '',
  entity_type: 'agent',
  condition_field: 'status',
  condition_operator: 'equals',
  condition_value: '',
  cooldown_minutes: 60,
  recipient: 'system',
}

export function CreateRuleForm({ onCreated, onCancel }: CreateRuleFormProps): React.JSX.Element {
  const t = useTranslations('alertRules')
  const [form, setForm] = useState<CreateRuleFormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fields = ENTITY_FIELDS[form.entity_type] ?? []

  const handleEntityTypeChange = (entity_type: string): void => {
    setForm({ ...form, entity_type, condition_field: ENTITY_FIELDS[entity_type]?.[0] ?? 'status' })
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          entity_type: form.entity_type,
          condition_field: form.condition_field,
          condition_operator: form.condition_operator,
          condition_value: form.condition_value,
          cooldown_minutes: form.cooldown_minutes,
          action_type: 'notification',
          action_config: { recipient: form.recipient },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('failedToCreate'))
        return
      }
      onCreated()
    } catch {
      setError(t('networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/20 rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{t('newRuleTitle')}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">{t('ruleName')}</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder={t('ruleNamePlaceholder')}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">{t('ruleDescription')}</label>
          <input
            type="text"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder={t('optionalDescription')}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <ConditionSelector form={form} fields={fields} onFormChange={setForm} onEntityTypeChange={handleEntityTypeChange} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">{t('cooldownMinutes')}</label>
          <input
            type="number"
            value={form.cooldown_minutes}
            onChange={e => setForm({ ...form, cooldown_minutes: parseInt(e.target.value) || 60 })}
            min={1}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">{t('notifyRecipient')}</label>
          <input
            type="text"
            value={form.recipient}
            onChange={e => setForm({ ...form, recipient: e.target.value })}
            placeholder="system"
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="button" onClick={onCancel} variant="outline" size="sm">
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={saving} size="sm">
          {saving ? t('creating') : t('createRule')}
        </Button>
      </div>
    </form>
  )
}

interface ConditionSelectorProps {
  form: CreateRuleFormState
  fields: string[]
  onFormChange: (form: CreateRuleFormState) => void
  onEntityTypeChange: (entityType: string) => void
}

function ConditionSelector({ form, fields, onFormChange, onEntityTypeChange }: ConditionSelectorProps): React.JSX.Element {
  const t = useTranslations('alertRules')
  const inputClass = 'w-full h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary'

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div>
        <label className="block text-2xs text-muted-foreground mb-1">{t('entity')}</label>
        <select value={form.entity_type} onChange={e => onEntityTypeChange(e.target.value)} className={inputClass}>
          <option value="agent">{t('entityAgent')}</option>
          <option value="task">{t('entityTask')}</option>
          <option value="session">{t('entitySession')}</option>
          <option value="activity">{t('entityActivity')}</option>
        </select>
      </div>
      <div>
        <label className="block text-2xs text-muted-foreground mb-1">{t('field')}</label>
        <select value={form.condition_field} onChange={e => onFormChange({ ...form, condition_field: e.target.value })} className={inputClass}>
          {fields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-2xs text-muted-foreground mb-1">{t('operator')}</label>
        <select value={form.condition_operator} onChange={e => onFormChange({ ...form, condition_operator: e.target.value })} className={inputClass}>
          {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-2xs text-muted-foreground mb-1">{t('value')}</label>
        <input
          type="text"
          value={form.condition_value}
          onChange={e => onFormChange({ ...form, condition_value: e.target.value })}
          placeholder={t('valuePlaceholder')}
          className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          required
        />
      </div>
    </div>
  )
}
