'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'


// --- Types ---

export interface PropertyOption {
  value: string
  label: string
  icon?: ReactNode
  group?: string
  hotkey?: string
}

interface PropertyChipProps {
  value: string
  icon?: ReactNode
  options: PropertyOption[]
  onSelect: (value: string) => void
  searchable?: boolean
  colorFn?: (value: string) => string
  label?: string
  placeholder?: ReactNode
}

// --- PropertyChip ---

export function PropertyChip({
  value,
  icon,
  options,
  onSelect,
  searchable = false,
  colorFn,
  label,
  placeholder,
}: PropertyChipProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const displayOption = options.find(o => o.value === value)
  const isEmpty = !value
  const displayLabel = displayOption?.label || value || 'Not assigned'
  const displayIcon = isEmpty && placeholder ? placeholder : (displayOption?.icon || icon)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus search on open
  useEffect(() => {
    if (open && searchable && searchRef.current) {
      searchRef.current.focus()
    }
  }, [open, searchable])

  // Keyboard nav
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setSearch('')
    }
  }, [])

  const filtered = search
    ? options.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        o.value.toLowerCase().includes(search.toLowerCase())
      )
    : options

  // Group options
  const groups = new Map<string, PropertyOption[]>()
  for (const opt of filtered) {
    const g = opt.group || ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(opt)
  }

  const chipColor = colorFn ? colorFn(value) : 'bg-surface-1 text-muted-foreground'

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Chip button */}
      <Button
        variant="outline"
        size="xs"
        onClick={() => setOpen(!open)}
        className={`bg-zinc-900 ${open ? 'ring-1 ring-primary/40' : ''} ${isEmpty && placeholder ? 'px-1.5' : ''}`}
        title={label ? `${label}: ${displayLabel}` : displayLabel}
      >
        {displayIcon && <span className="flex items-center">{displayIcon}</span>}
        {!(isEmpty && placeholder) && <span>{label && isEmpty ? label : displayLabel}</span>}
      </Button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-48 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-border">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full bg-surface-1 text-foreground text-xs px-2.5 py-1.5 rounded-md border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto py-1">
            {[...groups.entries()].map(([groupName, groupOptions]) => (
              <div key={groupName}>
                {groupName && (
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                    {groupName}
                  </div>
                )}
                {groupOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onSelect(opt.value)
                      setOpen(false)
                      setSearch('')
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-surface-2 ${
                      opt.value === value ? 'bg-surface-1 text-foreground' : 'text-foreground/80'
                    }`}
                  >
                    {opt.icon && <span className="flex items-center justify-center text-[11px] w-4 [&>svg]:w-3.5 [&>svg]:h-3.5">{opt.icon}</span>}
                    <span className="flex-1">{opt.label}</span>
                    {opt.hotkey && (
                      <span className="text-[10px] text-muted-foreground/40 font-mono">{opt.hotkey}</span>
                    )}
                    {opt.value === value && (
                      <span className="text-primary text-[11px]">✓</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground/50">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
