'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { questionsFromDrafts, type DraftType, type QuestionDraft } from './jev-policy-draft'
import { JevChoiceFields, JevNoulFields, JevScoreFields } from './jev-question-fields'

const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-void-cyan'
const TYPES: Array<{ id: DraftType; label: string; help: string }> = [
  { id: 'noul', label: 'Yes / No', help: "Is it or isn't it, with how sure." },
  { id: 'choice', label: 'Choose one', help: 'Picks one from your named options.' },
  { id: 'score', label: 'Score', help: 'Rates it on a scale you define.' },
]

export function JevQuestionEditorDialog({
  initial,
  existingIds,
  canDelete,
  onSave,
  onDelete,
  onClose,
}: {
  initial: QuestionDraft
  existingIds: string[]
  canDelete: boolean
  onSave: (draft: QuestionDraft) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    nameRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled'))
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = originalOverflow
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [onClose])

  const update = (values: Partial<QuestionDraft>) => setDraft((current) => ({ ...current, ...values }))
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const id = draft.id.trim()
      if (!id) throw new Error('Add a short result name')
      if (!draft.instructions.trim()) throw new Error('Write the question Jev should answer')
      if (existingIds.includes(id)) throw new Error('That result name is already used by another question')
      questionsFromDrafts([draft])
      await onSave({ ...draft, id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the question')
    } finally { setSaving(false) }
  }
  const remove = async () => {
    if (!onDelete || !window.confirm('Delete this question? Existing evaluation history will remain unchanged.')) return
    setSaving(true); setError(null)
    try { await onDelete() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete the question') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/65 p-3 md:p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="jev-question-dialog-title" aria-describedby="jev-question-dialog-description" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex min-h-14 shrink-0 items-center border-b border-border px-5">
          <h2 id="jev-question-dialog-title" className="min-w-0 flex-1 text-base font-semibold text-foreground">{onDelete ? 'Edit question' : 'New question'}</h2>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close question editor" onClick={onClose}>×</Button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-8">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-foreground">Answer type</legend>
            <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border sm:grid-cols-3" role="radiogroup">
              {TYPES.map((type) => (
                <button key={type.id} type="button" role="radio" aria-checked={draft.type === type.id} onClick={() => update({ type: type.id })} className={`min-h-20 border-b border-border p-3 text-left last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${draft.type === type.id ? 'bg-void-cyan/10 text-void-cyan' : 'bg-background text-foreground hover:bg-secondary/40'}`}>
                  <span className="block text-sm font-medium">{type.label}</span><span className="mt-1 block text-xs text-muted-foreground">{type.help}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs text-muted-foreground">Result name
            <input ref={nameRef} className={`${field} mt-1`} value={draft.id} onChange={(event) => update({ id: event.target.value })} placeholder="release_decision" maxLength={120} />
          </label>
          <label className="block text-xs text-muted-foreground">Question
            <textarea aria-label="Question" className={`${field} mt-1 min-h-28 resize-y`} value={draft.instructions} onChange={(event) => update({ instructions: event.target.value })} placeholder="Write the question in full…" maxLength={4000} />
          </label>
          <p id="jev-question-dialog-description" className="-mt-3 text-xs text-muted-foreground">Jev reads this question and only the context you review before running.</p>
          {draft.type === 'noul' && <JevNoulFields draft={draft} onChange={update} />}
          {draft.type === 'choice' && <JevChoiceFields draft={draft} onChange={update} />}
          {draft.type === 'score' && <JevScoreFields draft={draft} onChange={update} />}
          {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        </div>
        <footer className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-3 md:px-8">
          {onDelete && <Button type="button" variant="ghost" className="text-red-400" disabled={!canDelete || saving} onClick={() => void remove()}>Delete</Button>}
          {!canDelete && onDelete && <span className="text-xs text-muted-foreground">A policy needs at least one question.</span>}
          <div className="ml-auto flex gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save question'}</Button></div>
        </footer>
      </div>
    </div>
  )
}
