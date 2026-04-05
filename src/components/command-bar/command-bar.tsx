'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { buildCommandRegistry, STATIC_COMMAND_REGISTRY, type Command } from './command-registry'
import { CommandItem } from './command-item'

interface CommandBarProps {
  readonly isOpen: boolean
  readonly onClose: () => void
}

const GROUP_ORDER = ['panel', 'action', 'agent'] as const
const GROUP_LABELS: Record<string, string> = {
  panel:  'Panels',
  action: 'Actions',
  agent:  'Agents',
}

const FUSE_OPTIONS = {
  keys: [
    { name: 'label',       weight: 0.5 },
    { name: 'description', weight: 0.2 },
    { name: 'keywords',    weight: 0.3 },
  ],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
}

/** Groups a flat command list by type while preserving order. */
function groupCommands(commands: readonly Command[]): Array<{ type: string; commands: Command[] }> {
  const map = new Map<string, Command[]>()
  for (const cmd of commands) {
    const bucket = map.get(cmd.type) ?? []
    bucket.push(cmd)
    map.set(cmd.type, bucket)
  }
  return GROUP_ORDER
    .filter(t => map.has(t))
    .map(t => ({ type: t, commands: map.get(t)! }))
}

/**
 * Global ⌘K command palette.
 * Renders via a portal so it always sits on top of the layout.
 */
export function CommandBar({ isOpen, onClose }: CommandBarProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isMounted, setIsMounted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigateToPanel = useNavigateToPanel()

  // Build full registry from live agents stored in Zustand
  const { agents } = useMissionControl()
  const registry = useMemo((): readonly Command[] => {
    if (!agents || agents.length === 0) return STATIC_COMMAND_REGISTRY
    return buildCommandRegistry(
      agents.map(a => ({ name: a.name, role: a.role ?? '', department: a.status ?? '' }))
    )
  }, [agents])

  const fuse = useMemo(() => new Fuse(registry as Command[], FUSE_OPTIONS), [registry])

  const results: readonly Command[] = useMemo(() => {
    if (!query.trim()) return registry.slice(0, 24)
    return fuse.search(query).slice(0, 20).map(r => r.item)
  }, [query, registry, fuse])

  const groups = useMemo(() => groupCommands(results), [results])

  // Flat ordered list for keyboard navigation
  const flatResults = useMemo(() => groups.flatMap(g => g.commands), [groups])

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(0) }, [results])

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      // micro-delay to let portal render first
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  useEffect(() => { setIsMounted(true) }, [])

  const handleSelect = useCallback((cmd: Command): void => {
    if (cmd.panelId) navigateToPanel(cmd.panelId)
    onClose()
  }, [navigateToPanel, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = flatResults[selectedIndex]
      if (cmd) handleSelect(cmd)
    }
  }, [flatResults, selectedIndex, handleSelect, onClose])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-command-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!isMounted || !isOpen) return null

  let flatIndex = 0

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Palette panel */}
      <div className="relative w-full max-w-[44rem] mx-4 rounded-xl border border-white/[0.12] bg-[#0f1117]/95 shadow-2xl backdrop-blur-xl overflow-hidden">

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
          <span className="text-muted-foreground shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search panels, agents, actions…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls="command-bar-results"
            aria-activedescendant={flatResults[selectedIndex] ? `cbr-${selectedIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] font-mono text-muted-foreground shrink-0">
            Esc
          </kbd>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          id="command-bar-results"
          role="listbox"
          className="max-h-[min(60vh,26rem)] overflow-y-auto py-1"
        >
          {flatResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for &quot;{query}&quot;
            </div>
          ) : (
            groups.map(group => (
              <div key={group.type}>
                <div className="px-4 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground/50 uppercase">
                  {GROUP_LABELS[group.type]}
                </div>
                {group.commands.map(cmd => {
                  const idx = flatIndex++
                  return (
                    <CommandItem
                      key={cmd.id}
                      command={cmd}
                      isSelected={idx === selectedIndex}
                      onClick={() => handleSelect(cmd)}
                      index={idx}
                    />
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-white/[0.06] text-[10px] text-muted-foreground/40">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
