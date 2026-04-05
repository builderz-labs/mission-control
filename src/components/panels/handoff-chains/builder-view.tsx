'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { StepCard } from './step-card'
import type { BuilderStep, HandoffChainParsed } from './types'
import type { HandoffStep } from './types'

// Re-export EMPTY_STEP so callers can use a fresh object without importing types
const EMPTY_STEP: BuilderStep = { agentName: '', promptTemplate: '', label: '' }

interface BuilderViewProps {
  editing: HandoffChainParsed | null
  onSaved: () => void
  onCancel: () => void
}

export function BuilderView({ editing, onSaved, onCancel }: BuilderViewProps): React.JSX.Element {
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [steps, setSteps] = useState<BuilderStep[]>(
    editing
      ? editing.steps.map(s => ({ agentName: s.agentName, promptTemplate: s.promptTemplate, label: s.label }))
      : [{ ...EMPTY_STEP }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValid = name.trim().length > 0 && steps.length >= 1

  const addStep = (): void => setSteps(s => [...s, { ...EMPTY_STEP }])

  const removeStep = (index: number): void =>
    setSteps(s => s.filter((_, i) => i !== index))

  const moveStep = (index: number, dir: -1 | 1): void => {
    setSteps(s => {
      const arr = [...s]
      const target = index + dir
      if (target < 0 || target >= arr.length) return arr
      // Swap using map to stay immutable
      return arr.map((item, i) => {
        if (i === index) return arr[target]
        if (i === target) return arr[index]
        return item
      })
    })
  }

  const handleStepChange = (index: number, field: keyof BuilderStep, value: string): void => {
    setSteps(s => s.map((step, i) => i === index ? { ...step, [field]: value } : step))
  }

  const handleSave = async (): Promise<void> => {
    if (!isValid) return
    setSaving(true)
    setError(null)

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      steps: steps.map(s => ({
        agentName: s.agentName.trim(),
        promptTemplate: s.promptTemplate.trim(),
        label: s.label.trim(),
      } satisfies HandoffStep)),
    }

    try {
      const url = editing ? `/api/handoff-chains/${editing.id}` : '/api/handoff-chains'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Save failed')
        return
      }
      onSaved()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {editing ? 'Edit Chain' : 'New Chain'}
        </span>
        <Button onClick={onCancel} variant="ghost" size="xs">Cancel</Button>
      </div>

      {error && (
        <div className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400">{error}</div>
      )}

      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Chain name (required)"
        className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/60"
      />
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/60"
      />

      <div className="space-y-2">
        <span className="text-2xs text-muted-foreground">Steps ({steps.length})</span>
        {steps.map((step, i) => (
          <StepCard
            key={i}
            step={step}
            index={i}
            total={steps.length}
            onChange={handleStepChange}
            onMove={moveStep}
            onRemove={removeStep}
          />
        ))}
        <Button onClick={addStep} variant="secondary" size="xs" className="w-full">
          + Add Step
        </Button>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!isValid || saving} size="xs">
          {saving ? 'Saving…' : editing ? 'Update Chain' : 'Create Chain'}
        </Button>
      </div>
    </div>
  )
}
