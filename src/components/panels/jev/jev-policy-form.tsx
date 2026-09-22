'use client'

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { draftFromPolicy, emptyQuestion, questionsFromDrafts, type QuestionDraft } from './jev-policy-draft'
import type { JevPolicy, JevPolicyInput } from './jev-ui-types'

const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-void-cyan'

export function JevPolicyForm({
  policy, onSubmit, onCancel,
}: {
  policy?: JevPolicy | null
  onSubmit: (input: JevPolicyInput) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(policy?.name ?? '')
  const [description, setDescription] = useState(policy?.description ?? '')
  const [model, setModel] = useState(policy?.model ?? 'jev-latest')
  const [mode, setMode] = useState<'manual' | 'shadow'>(policy?.mode ?? 'shadow')
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => draftFromPolicy(policy))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(policy?.name ?? '')
    setDescription(policy?.description ?? '')
    setModel(policy?.model ?? 'jev-latest')
    setMode(policy?.mode ?? 'shadow')
    setQuestions(draftFromPolicy(policy))
    setError(null)
  }, [policy])
  const update = (index: number, values: Partial<QuestionDraft>) => {
    setQuestions((current) => current.map((item, i) => i === index ? { ...item, ...values } : item))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const parsed = questionsFromDrafts(questions)
      await onSubmit({ name, description, model, mode, questions: parsed, enabled: policy?.enabled ?? true })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save policy')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div><h3 className="text-sm font-semibold text-foreground">{policy ? 'Edit evaluation goal' : 'Create a custom evaluation goal'}</h3><p className="mt-1 text-xs text-muted-foreground">Describe the decision in everyday language. Technical settings can stay at their defaults.</p></div>
      <div className="grid gap-3">
        <label className="text-xs text-muted-foreground">Goal name
          <input className={`${field} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </label>
        <label className="text-xs text-muted-foreground">What should this evaluation help decide?
          <input className={`${field} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </label>
      </div>

      <details className="rounded-md border border-border bg-background/40 p-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">Advanced settings</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted-foreground">Model<input className={`${field} mt-1 font-mono`} value={model} onChange={(e) => setModel(e.target.value)} required /></label><label className="text-xs text-muted-foreground">Mode<select className={`${field} mt-1`} value={mode} onChange={(e) => setMode(e.target.value as 'manual' | 'shadow')}><option value="shadow">Shadow — observe only</option><option value="manual">Manual — operator run</option></select></label></div>
      </details>

      <div className="space-y-3">
        {questions.map((question, index) => (
          <div key={index} className="space-y-3 rounded-md border border-border bg-background/40 p-3">
            <p className="text-xs font-medium text-foreground">Question {index + 1}</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
              <input aria-label="Short result name" className={field} value={question.id} onChange={(e) => update(index, { id: e.target.value })} placeholder="release_decision" required />
              <select aria-label="Question type" className={field} value={question.type} onChange={(e) => update(index, { type: e.target.value as QuestionDraft['type'] })}>
                <option value="noul">Yes / no (Noul)</option><option value="choice">Choose one</option><option value="score">Rating scale</option>
              </select>
              <Button type="button" variant="ghost" size="sm" disabled={questions.length === 1} onClick={() => setQuestions((items) => items.filter((_, i) => i !== index))}>Remove</Button>
            </div>
            <textarea aria-label="Question instructions" className={`${field} min-h-20 resize-y`} value={question.instructions} onChange={(e) => update(index, { instructions: e.target.value })} placeholder="Write the question in plain language…" required />
            {question.type === 'noul' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <input aria-label="What yes means" className={field} value={question.positive} onChange={(e) => update(index, { positive: e.target.value })} placeholder="Yes means… (optional)" />
                <input aria-label="What no means" className={field} value={question.negative} onChange={(e) => update(index, { negative: e.target.value })} placeholder="No means… (optional)" />
              </div>
            ) : (
              <textarea aria-label="Answer options" className={`${field} min-h-24 font-mono text-xs`} value={question.criteria} onChange={(e) => update(index, { criteria: e.target.value })}
                placeholder={question.type === 'choice' ? 'approved: Meets the bar\nchanges: Needs changes' : 'Poor\nAcceptable\nExcellent'} required />
            )}
            <p className="text-[11px] text-muted-foreground">{question.type === 'choice' ? 'Add one “name: meaning” option per line.' : question.type === 'score' ? 'Add 2–10 levels from lowest to highest, one per line.' : 'Optional descriptions help Jev understand what yes and no mean.'}</p>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setQuestions((items) => [...items, emptyQuestion()])}>Add question</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : policy ? 'Save policy' : 'Create policy'}</Button></div>
    </form>
  )
}
