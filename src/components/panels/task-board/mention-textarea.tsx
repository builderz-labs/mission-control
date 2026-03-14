'use client'

import { useState, useEffect, useRef } from 'react'
import type { MentionOption } from './types'

export function useMentionTargets() {
  const [mentionTargets, setMentionTargets] = useState<MentionOption[]>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const response = await fetch('/api/mentions?limit=200')
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled) setMentionTargets(data.mentions || [])
      } catch {
        // mention autocomplete is non-critical
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  return mentionTargets
}

export function MentionTextarea({
  id,
  value,
  onChange,
  rows = 3,
  placeholder,
  className,
  mentionTargets,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
  className?: string
  mentionTargets: MentionOption[]
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [openUpwards, setOpenUpwards] = useState(false)

  const filtered = mentionTargets
    .filter((target) => {
      if (!query) return true
      const q = query.toLowerCase()
      return target.handle.includes(q) || target.display.toLowerCase().includes(q)
    })
    .slice(0, 8)

  const detectMentionQuery = (nextValue: string, caret: number) => {
    const left = nextValue.slice(0, caret)
    const match = left.match(/(?:^|[^\w.-])@([A-Za-z0-9._-]{0,63})$/)
    if (!match) {
      setOpen(false)
      setQuery('')
      setRange(null)
      return
    }
    const matched = match[1] || ''
    const start = caret - matched.length - 1
    setQuery(matched)
    setRange({ start, end: caret })
    setActiveIndex(0)
    setOpen(true)
  }

  const insertMention = (option: MentionOption) => {
    if (!range) return
    const next = `${value.slice(0, range.start)}@${option.handle} ${value.slice(range.end)}`
    onChange(next)
    setOpen(false)
    setQuery('')
    const cursor = range.start + option.handle.length + 2
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(cursor, cursor)
    })
  }

  useEffect(() => {
    if (!open) return
    const node = textareaRef.current
    if (!node) return

    const rect = node.getBoundingClientRect()
    const estimatedMenuHeight = Math.min(Math.max(filtered.length, 1) * 46 + 12, 224)
    const availableBelow = window.innerHeight - rect.bottom
    const availableAbove = rect.top
    setOpenUpwards(availableBelow < estimatedMenuHeight && availableAbove > availableBelow)
  }, [open, filtered.length])

  return (
    <div className="relative">
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          const nextValue = e.target.value
          onChange(nextValue)
          detectMentionQuery(nextValue, e.target.selectionStart || 0)
        }}
        onClick={(e) => detectMentionQuery(value, (e.target as HTMLTextAreaElement).selectionStart || 0)}
        onKeyUp={(e) => detectMentionQuery(value, (e.target as HTMLTextAreaElement).selectionStart || 0)}
        onKeyDown={(e) => {
          if (!open || filtered.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((prev) => (prev + 1) % filtered.length)
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            insertMention(filtered[activeIndex])
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        rows={rows}
        placeholder={placeholder}
        className={className}
      />
      {open && filtered.length > 0 && (
        <div className={`absolute z-[60] w-full bg-surface-1 border border-border rounded-md shadow-xl max-h-56 overflow-y-auto ${
          openUpwards ? 'bottom-full mb-1' : 'mt-1'
        }`}>
          {filtered.map((option, index) => (
            <button
              key={`${option.type}-${option.handle}-${option.recipient}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(option)
              }}
              className={`w-full text-left px-3 py-2 text-xs border-b last:border-b-0 border-border/40 ${
                index === activeIndex ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-surface-2'
              }`}
            >
              <div className="font-mono">@{option.handle}</div>
              <div className="text-muted-foreground">
                {option.display} • {option.type}{option.role ? ` • ${option.role}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
