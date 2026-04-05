'use client'

import { Button } from '@/components/ui/button'
import { AddForm } from './types'

interface AddProviderFormProps {
  form: AddForm
  submitting: boolean
  onChange: (form: AddForm) => void
  onSubmit: () => void
  onCancel: () => void
}

export function AddProviderForm({
  form,
  submitting,
  onChange,
  onSubmit,
  onCancel,
}: AddProviderFormProps): React.JSX.Element {
  // Helper to produce an onChange handler for a specific field
  const set =
    (key: keyof AddForm) =>
    (e: React.ChangeEvent<HTMLInputElement>): void =>
      onChange({ ...form, [key]: e.target.value })

  return (
    <div className="mb-4 rounded-lg border border-border bg-card/50 p-4">
      <p className="text-xs font-medium text-muted-foreground mb-3">
        Common providers: anthropic, openai, cohere
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Provider *</label>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="e.g. anthropic"
            value={form.provider}
            onChange={set('provider')}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="auto"
            value={form.priority}
            onChange={set('priority')}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Max Retries</label>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.max_retries}
            onChange={set('max_retries')}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Timeout (ms)</label>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.timeout_ms}
            onChange={set('timeout_ms')}
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1 block">
          Capability Tags (comma-separated)
        </label>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="e.g. vision, function-calling"
          value={form.capability_tags}
          onChange={set('capability_tags')}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={submitting || !form.provider.trim()}>
          {submitting ? 'Adding…' : 'Add Provider'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
