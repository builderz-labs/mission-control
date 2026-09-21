'use client'

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { jevQuestionsSchema } from '@/lib/jev-validation'
import { draftsFromQuestions, emptyQuestion, questionsFromDrafts, type QuestionDraft } from './jev-policy-draft'
import { JevQuestionEditorDialog } from './jev-question-editor-dialog'

const labels = { noul: 'Yes / No', choice: 'Category', score: 'Score' }

export function JevDraftQuestions({ schemaText, disabled, onChange }: {
  schemaText: string; disabled: boolean; onChange: (text: string) => void
}) {
  const [editing, setEditing] = useState<{ originalId: string | null; draft: QuestionDraft } | null>(null)
  const close = useCallback(() => setEditing(null), [])
  let drafts: QuestionDraft[] = []
  let error = ''
  try { drafts = draftsFromQuestions(jevQuestionsSchema.parse(JSON.parse(schemaText))) }
  catch { error = 'The question schema is invalid. Fix the advanced JSON below or ask the assistant to revise it.' }
  const replace = (next: QuestionDraft[]) => onChange(JSON.stringify(jevQuestionsSchema.parse(questionsFromDrafts(next)), null, 2))
  return <section aria-label="Draft questions" className="space-y-3">
    <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-foreground">Your questions <span className="text-muted-foreground">({drafts.length})</span></h3><p className="text-xs text-muted-foreground">Names, answer types and criteria are filled in. Edit anything before saving.</p></div><Button variant="outline" size="sm" disabled={disabled || Boolean(error) || drafts.length >= 50} onClick={() => setEditing({ originalId: null, draft: { ...emptyQuestion(), id: '' } })}>Add question</Button></div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="grid gap-3 md:grid-cols-2">{drafts.map((draft) => <article key={draft.id} className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-void-cyan">{labels[draft.type]}</p><h4 className="mt-1 font-medium capitalize text-foreground">{draft.id.replaceAll('_', ' ')}</h4></div><Button size="sm" variant="ghost" disabled={disabled} aria-label={`Edit ${draft.id.replaceAll('_', ' ')}`} onClick={() => setEditing({ originalId: draft.id, draft })}>Edit</Button></div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{draft.instructions}</p>
      {draft.type === 'noul' ? <dl className="mt-3 space-y-1 text-xs text-muted-foreground">{draft.positive && <div><dt className="inline font-semibold">Yes: </dt><dd className="inline">{draft.positive}</dd></div>}{draft.negative && <div><dt className="inline font-semibold">No: </dt><dd className="inline">{draft.negative}</dd></div>}</dl>
        : <ol className="mt-3 space-y-1 text-xs text-muted-foreground">{draft.criteria.split('\n').map((line, index) => <li key={index} className="break-words">{draft.type === 'score' ? `${index + 1}. ` : ''}{line}</li>)}</ol>}
    </article>)}</div>
    {editing && <JevQuestionEditorDialog initial={editing.draft} existingIds={drafts.filter((item) => item.id !== editing.originalId).map((item) => item.id)} canDelete={drafts.length > 1} onClose={close}
      onSave={async (draft) => { replace(editing.originalId ? drafts.map((item) => item.id === editing.originalId ? draft : item) : [...drafts, draft]); close() }}
      onDelete={editing.originalId ? async () => { replace(drafts.filter((item) => item.id !== editing.originalId)); close() } : undefined} />}
  </section>
}
