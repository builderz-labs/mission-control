'use client'

/**
 * Guidance Panel — Commander's Intent 4-level guidance browser & editor.
 *
 * Reads from GUIDANCE_ROOT on disk via /api/lionroot/guidance.
 * Shows coverage stats, lets you browse/edit/create guidance files.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'

/* ── Types ── */

interface InventoryItem {
  slug: string
  label: string
  path: string
  exists: boolean
  content?: string
}

interface GuidanceInventory {
  standard: InventoryItem
  agents: InventoryItem[]
  channels: InventoryItem[]
  topics: InventoryItem[]
  coverage: {
    agents: { total: number; covered: number }
    channels: { total: number; covered: number }
  }
}

type GuidanceLevel = 'standard' | 'agent' | 'channel' | 'topic'

interface SelectedItem {
  level: GuidanceLevel
  slug: string
  label: string
  exists: boolean
}

/* ── Templates ── */

function agentTemplate(slug: string, label: string): string {
  return `# ${label}

## Domain


## Workflow
1. Check Zulip stream for new messages and topics
2. Review assigned loops and missions
3. Process tasks in priority order
4. Report progress and escalate blockers

## Key Repositories & Files
-

## Zulip Stream


## Current Focus


## Coordination
- Escalate blockers to Bryan via needs-bryan stream
- Coordinate with related agents on cross-cutting work
`
}

function channelTemplate(slug: string, label: string): string {
  return `# ${label}

## Purpose


## Key Repositories & Files
-

## Priority Topics
-

## Active Agents
-

## Workflow Guidelines

`
}

/* ── Coverage Badge ── */

function CoverageBadge({ covered, total }: { covered: number; total: number }) {
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0
  const color =
    pct === 100
      ? 'bg-green-500/10 text-green-400 border-green-500/30'
      : pct >= 50
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
        : 'bg-red-500/10 text-red-400 border-red-500/30'
  return (
    <span className={`ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded border ${color}`}>
      {covered}/{total}
    </span>
  )
}

/* ── Sidebar Icons (inline SVGs) ── */

function FileIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
      <path d="M9 1v4h4" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-2.5 2.5-4.5 6-4.5s6 2 6 4.5" />
    </svg>
  )
}

function RadioIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-green-400 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l3 3 7-7" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1L1 14h14L8 1z" />
      <path d="M8 6v3M8 11.5v.5" />
    </svg>
  )
}

/* ── Sidebar Item ── */

function SidebarItem({
  item,
  isSelected,
  onClick,
}: {
  item: InventoryItem
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 rounded text-[13px] transition-colors flex items-center gap-2 ${
        isSelected
          ? 'bg-blue-500/15 text-blue-300 font-medium'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`}
    >
      {item.exists ? <CheckIcon /> : <WarningIcon />}
      <span className="truncate flex-1">{item.label}</span>
      {!item.exists && (
        <span className="text-[9px] text-amber-500 uppercase font-semibold shrink-0">
          Missing
        </span>
      )}
    </button>
  )
}

/* ── Collapsible Section ── */

function Section({
  id,
  label,
  icon,
  expanded,
  onToggle,
  badge,
  children,
}: {
  id: string
  label: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-3">
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 px-1"
        onClick={onToggle}
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
        {icon}
        {label}
        {badge}
      </button>
      {expanded && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

/* ── Main Panel ── */

export function GuidancePanel() {
  const [inventory, setInventory] = useState<GuidanceInventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<SelectedItem | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['standard', 'agents', 'channels']),
  )

  const [fileContent, setFileContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [createMode, setCreateMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Load inventory ──

  const loadInventory = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/lionroot/guidance?mode=inventory')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as GuidanceInventory
      setInventory(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInventory()
  }, [loadInventory])

  // ── Section toggle ──

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }, [])

  // ── Select item + load content ──

  const selectItem = useCallback(async (item: InventoryItem, level: GuidanceLevel) => {
    setSelected({ level, slug: item.slug, label: item.label, exists: item.exists })
    setEditMode(false)
    setCreateMode(false)
    setSaveError(null)

    if (!item.exists) {
      setFileContent('')
      return
    }

    setLoadingContent(true)
    try {
      const res = await fetch(
        `/api/lionroot/guidance?level=${encodeURIComponent(level)}&slug=${encodeURIComponent(item.slug)}`,
      )
      if (res.ok) {
        const data = (await res.json()) as { content?: string }
        setFileContent(data.content || '')
      } else {
        setFileContent('')
      }
    } catch {
      setFileContent('')
    } finally {
      setLoadingContent(false)
    }
  }, [])

  // ── Edit / Create / Save ──

  const startEdit = useCallback(() => {
    setEditContent(fileContent)
    setEditMode(true)
    setSaveError(null)
  }, [fileContent])

  const startCreate = useCallback(() => {
    if (!selected) return
    const template =
      selected.level === 'agent'
        ? agentTemplate(selected.slug, selected.label)
        : selected.level === 'channel'
          ? channelTemplate(selected.slug, selected.label)
          : `# ${selected.label}\n\n`
    setEditContent(template)
    setCreateMode(true)
    setEditMode(true)
    setSaveError(null)
  }, [selected])

  const handleSave = useCallback(async () => {
    if (!selected) return
    setSaving(true)
    setSaveError(null)

    const method = createMode ? 'POST' : 'PUT'
    try {
      const res = await fetch('/api/lionroot/guidance', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: selected.level,
          slug: selected.slug,
          content: editContent,
        }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { message?: string; error?: string }
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }

      setFileContent(editContent)
      setEditMode(false)
      setCreateMode(false)
      setSelected((prev) => (prev ? { ...prev, exists: true } : null))
      // Refresh inventory for coverage counts
      loadInventory()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [selected, editContent, createMode, loadInventory])

  const cancelEdit = useCallback(() => {
    setEditMode(false)
    setCreateMode(false)
    setSaveError(null)
  }, [])

  // ── Sorted lists ──

  const sortedAgents = useMemo(() => {
    if (!inventory) return []
    return [...inventory.agents].sort((a, b) => {
      if (a.exists !== b.exists) return a.exists ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  }, [inventory])

  const sortedChannels = useMemo(() => {
    if (!inventory) return []
    return [...inventory.channels].sort((a, b) => {
      if (a.exists !== b.exists) return a.exists ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  }, [inventory])

  // ── Render ──

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <p className="animate-pulse text-sm">Loading guidance inventory…</p>
      </div>
    )
  }

  if (error || !inventory) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        <div className="text-center">
          <p className="text-sm font-medium">Failed to load guidance</p>
          <p className="text-xs mt-1 text-zinc-500">{error}</p>
          <button
            type="button"
            className="mt-3 px-3 py-1 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            onClick={loadInventory}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-64 shrink-0 border-r border-zinc-800 overflow-y-auto p-3 space-y-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Guidance</h2>
            <p className="text-[11px] text-zinc-500">
              {inventory.coverage.agents.covered}/{inventory.coverage.agents.total} agents
              {' · '}
              {inventory.coverage.channels.covered}/{inventory.coverage.channels.total} channels
            </p>
          </div>
          <button
            type="button"
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={loadInventory}
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 8a7 7 0 0112.9-3.8M15 2v4h-4" />
              <path d="M15 8a7 7 0 01-12.9 3.8M1 14v-4h4" />
            </svg>
          </button>
        </div>

        {/* Level 1 — Standard */}
        <Section
          id="standard"
          label="Level 1 — Standard"
          icon={<FileIcon />}
          expanded={expandedSections.has('standard')}
          onToggle={() => toggleSection('standard')}
        >
          <SidebarItem
            item={inventory.standard}
            isSelected={selected?.level === 'standard'}
            onClick={() => selectItem(inventory.standard, 'standard')}
          />
        </Section>

        {/* Level 2 — Agents */}
        <Section
          id="agents"
          label="Level 2 — Agents"
          icon={<UserIcon />}
          expanded={expandedSections.has('agents')}
          onToggle={() => toggleSection('agents')}
          badge={
            <CoverageBadge
              covered={inventory.coverage.agents.covered}
              total={inventory.coverage.agents.total}
            />
          }
        >
          {sortedAgents.map((agent) => (
            <SidebarItem
              key={agent.slug}
              item={agent}
              isSelected={selected?.level === 'agent' && selected.slug === agent.slug}
              onClick={() => selectItem(agent, 'agent')}
            />
          ))}
        </Section>

        {/* Level 3 — Channels */}
        <Section
          id="channels"
          label="Level 3 — Channels"
          icon={<RadioIcon />}
          expanded={expandedSections.has('channels')}
          onToggle={() => toggleSection('channels')}
          badge={
            <CoverageBadge
              covered={inventory.coverage.channels.covered}
              total={inventory.coverage.channels.total}
            />
          }
        >
          {sortedChannels.map((channel) => (
            <SidebarItem
              key={channel.slug}
              item={channel}
              isSelected={selected?.level === 'channel' && selected.slug === channel.slug}
              onClick={() => selectItem(channel, 'channel')}
            />
          ))}
        </Section>

        {/* Level 4 — Topics */}
        {inventory.topics.length > 0 && (
          <Section
            id="topics"
            label="Level 4 — Topics"
            icon={<FileIcon />}
            expanded={expandedSections.has('topics')}
            onToggle={() => toggleSection('topics')}
            badge={
              <span className="ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded border bg-zinc-800 text-zinc-400 border-zinc-700">
                {inventory.topics.length}
              </span>
            }
          >
            {inventory.topics.map((topic) => (
              <SidebarItem
                key={topic.slug}
                item={topic}
                isSelected={selected?.level === 'topic' && selected.slug === topic.slug}
                onClick={() => selectItem(topic, 'topic')}
              />
            ))}
          </Section>
        )}
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 overflow-y-auto p-6">
        {!selected ? (
          /* Empty state */
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-md">
              <svg className="w-12 h-12 mx-auto text-zinc-700 mb-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M5 5h6M5 8h4M5 11h5" />
              </svg>
              <h2 className="text-lg font-semibold text-zinc-200 mb-2">Commander&apos;s Intent Guidance</h2>
              <p className="text-sm text-zinc-500 mb-6">
                Select a guidance file from the sidebar. Items with a ⚠️ are missing and can be created.
              </p>
              <div className="flex gap-4 justify-center text-sm">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 min-w-[80px]">
                  <div className="font-semibold text-zinc-200">
                    {inventory.coverage.agents.covered}/{inventory.coverage.agents.total}
                  </div>
                  <div className="text-[11px] text-zinc-500">Agents</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 min-w-[80px]">
                  <div className="font-semibold text-zinc-200">
                    {inventory.coverage.channels.covered}/{inventory.coverage.channels.total}
                  </div>
                  <div className="text-[11px] text-zinc-500">Channels</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 min-w-[80px]">
                  <div className="font-semibold text-zinc-200">{inventory.topics.length}</div>
                  <div className="text-[11px] text-zinc-500">Topics</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">{selected.label}</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Level{' '}
                  {selected.level === 'standard'
                    ? '1'
                    : selected.level === 'agent'
                      ? '2'
                      : selected.level === 'channel'
                        ? '3'
                        : '4'}
                  {' · '}
                  <code className="text-[11px] text-zinc-600">{selected.slug}</code>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selected.exists && !editMode && (
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                    onClick={startEdit}
                  >
                    ✏️ Edit
                  </button>
                )}
                {!selected.exists && !editMode && (
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                    onClick={startCreate}
                  >
                    + Create Guidance
                  </button>
                )}
                {editMode && (
                  <>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-50"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? 'Saving…' : '💾 Save'}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Content area */}
            {loadingContent ? (
              <p className="text-sm text-zinc-500 animate-pulse">Loading content…</p>
            ) : editMode ? (
              <div className="space-y-2">
                <textarea
                  className="w-full min-h-[500px] rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm font-mono text-zinc-200 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                />
                {saveError && (
                  <p className="text-xs text-red-400">{saveError}</p>
                )}
              </div>
            ) : selected.exists ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-zinc-300">
                  {fileContent}
                </pre>
              </div>
            ) : (
              /* Missing file state */
              <div className="text-center py-16">
                <div className="flex justify-center">
                  <svg className="w-10 h-10 text-amber-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 1L1 14h14L8 1z" />
                    <path d="M8 6v3M8 11.5v.5" />
                  </svg>
                </div>
                <div className="mt-3">
                  <h3 className="text-sm font-semibold text-zinc-200 mb-1">No guidance file yet</h3>
                  <p className="text-xs text-zinc-500 mb-4 max-w-sm mx-auto">
                    This {selected.level} doesn&apos;t have a guidance file.
                    Create one to give your agents context about how to work in this area.
                  </p>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                    onClick={startCreate}
                  >
                    + Create Guidance File
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
