'use client'

import { Button } from '@/components/ui/button'
import type { QuestionDraft } from './jev-policy-draft'

const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-void-cyan'

export function JevNoulFields({ draft, onChange }: FieldProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-muted-foreground">What counts as yes <span className="opacity-70">optional</span>
        <textarea className={`${field} mt-1 min-h-24 resize-y`} value={draft.positive} onChange={(event) => onChange({ positive: event.target.value })} />
      </label>
      <label className="text-xs text-muted-foreground">What counts as no <span className="opacity-70">optional</span>
        <textarea className={`${field} mt-1 min-h-24 resize-y`} value={draft.negative} onChange={(event) => onChange({ negative: event.target.value })} />
      </label>
    </div>
  )
}

export function JevChoiceFields({ draft, onChange }: FieldProps) {
  const rows = draft.criteria ? draft.criteria.split('\n').map(splitChoice) : [['', ''], ['', '']]
  const update = (index: number, part: 0 | 1, value: string) => {
    const next = rows.map((row) => [...row] as [string, string])
    next[index][part] = value
    onChange({ criteria: joinChoices(next) })
  }
  const remove = (index: number) => onChange({ criteria: joinChoices(rows.filter((_, rowIndex) => rowIndex !== index)) })
  const add = () => onChange({ criteria: joinChoices([...rows, ['', '']]) })
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-foreground">Options</legend>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(120px,0.35fr)_minmax(220px,1fr)_auto]">
          <input aria-label={`Option ${index + 1} key`} className={field} value={row[0]} onChange={(event) => update(index, 0, event.target.value)} placeholder="approved" />
          <input aria-label={`Option ${index + 1} meaning`} className={field} value={row[1]} onChange={(event) => update(index, 1, event.target.value)} placeholder="What this option means" />
          <Button type="button" variant="ghost" size="icon-sm" disabled={rows.length <= 2} aria-label={`Remove option ${index + 1}`} onClick={() => remove(index)}>×</Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>+ Add option</Button>
    </fieldset>
  )
}

export function JevScoreFields({ draft, onChange }: FieldProps) {
  const rows = draft.criteria ? draft.criteria.split('\n') : ['', '']
  const update = (next: string[]) => onChange({ criteria: next.join('\n') })
  const move = (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    update(next)
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-foreground">Levels, lowest to highest</legend>
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[24px_minmax(0,1fr)_auto_auto_auto] items-center gap-1.5">
          <span className="text-right text-xs text-muted-foreground">{index + 1}</span>
          <input aria-label={`Score level ${index + 1}`} className={field} value={row} onChange={(event) => update(rows.map((item, rowIndex) => rowIndex === index ? event.target.value : item))} placeholder={`Describe level ${index + 1}`} />
          <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label={`Move level ${index + 1} up`} onClick={() => move(index, -1)}>↑</Button>
          <Button type="button" variant="ghost" size="icon-sm" disabled={index === rows.length - 1} aria-label={`Move level ${index + 1} down`} onClick={() => move(index, 1)}>↓</Button>
          <Button type="button" variant="ghost" size="icon-sm" disabled={rows.length <= 2} aria-label={`Remove level ${index + 1}`} onClick={() => update(rows.filter((_, rowIndex) => rowIndex !== index))}>×</Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={rows.length >= 10} onClick={() => update([...rows, ''])}>+ Add level</Button>
    </fieldset>
  )
}

interface FieldProps {
  draft: QuestionDraft
  onChange: (values: Partial<QuestionDraft>) => void
}

function splitChoice(line: string): [string, string] {
  const split = line.indexOf(':')
  return split < 0 ? [line, ''] : [line.slice(0, split), line.slice(split + 1).trimStart()]
}

function joinChoices(rows: string[][]): string {
  return rows.map(([key, meaning]) => `${key.trim()}: ${meaning.trim()}`).join('\n')
}
