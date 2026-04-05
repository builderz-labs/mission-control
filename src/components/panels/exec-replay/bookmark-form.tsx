'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface BookmarkFormProps {
  onSubmit: (label: string, note: string) => void
  onCancel: () => void
  submitting: boolean
}

export function BookmarkForm({ onSubmit, onCancel, submitting }: BookmarkFormProps): React.JSX.Element {
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')

  return (
    <div className="mt-3 p-3 rounded-lg bg-secondary/60 border border-border space-y-2">
      <p className="text-xs font-medium text-foreground">Add bookmark</p>
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Label (optional)"
        maxLength={200}
        className="w-full h-7 px-2 text-xs rounded-md bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Note (optional)"
        maxLength={2000}
        rows={2}
        className="w-full px-2 py-1.5 text-xs rounded-md bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
      />
      <div className="flex gap-2">
        <Button size="xs" onClick={() => onSubmit(label, note)} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
