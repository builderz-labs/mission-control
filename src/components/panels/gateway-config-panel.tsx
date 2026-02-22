'use client'

import { useState, useEffect, useCallback } from 'react'

interface ConfigNode {
  [key: string]: any
}

export function GatewayConfigPanel() {
  const [config, setConfig] = useState<ConfigNode | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['gateway', 'agents']))
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway-config')
      if (res.status === 403) {
        setError('Admin access required')
        return
      }
      if (res.status === 404) {
        const data = await res.json()
        setError(data.error || 'Config not found')
        return
      }
      if (!res.ok) {
        setError('Failed to load config')
        return
      }
      const data = await res.json()
      setConfig(data.config)
      setConfigPath(data.path)
    } catch {
      setError('Failed to load gateway config')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const startEdit = (dotPath: string, currentValue: any) => {
    setEditingKey(dotPath)
    setEditValue(typeof currentValue === 'object' ? JSON.stringify(currentValue, null, 2) : String(currentValue))
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditValue('')
  }

  const saveEdit = async () => {
    if (!editingKey) return

    let parsedValue: any = editValue
    // Try to parse as JSON for objects/arrays/numbers/booleans
    try {
      parsedValue = JSON.parse(editValue)
    } catch {
      // Keep as string
    }

    try {
      const res = await fetch('/api/gateway-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [editingKey]: parsedValue } }),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Updated ${editingKey}`)
        setEditingKey(null)
        setEditValue('')
        fetchConfig()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading gateway config...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
        <p className="text-xs text-muted-foreground mt-2">
          Ensure OPENCLAW_HOME is set and openclaw.json exists at the expected path.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Gateway Configuration</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          View and edit openclaw.json — <span className="font-mono">{configPath}</span>
        </p>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${
          feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Config tree */}
      {config && (
        <div className="space-y-2">
          {Object.entries(config).map(([key, value]) => (
            <ConfigSection
              key={key}
              sectionKey={key}
              value={value}
              dotPath={key}
              expanded={expandedSections.has(key)}
              onToggle={() => toggleSection(key)}
              editingKey={editingKey}
              editValue={editValue}
              onStartEdit={startEdit}
              onEditChange={setEditValue}
              onSaveEdit={saveEdit}
              onCancelEdit={cancelEdit}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ConfigSection({ sectionKey, value, dotPath, expanded, onToggle, editingKey, editValue, onStartEdit, onEditChange, onSaveEdit, onCancelEdit }: {
  sectionKey: string
  value: any
  dotPath: string
  expanded: boolean
  onToggle: () => void
  editingKey: string | null
  editValue: string
  onStartEdit: (path: string, value: any) => void
  onEditChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}) {
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
  const isArray = Array.isArray(value)

  if (isObject) {
    const childCount = Object.keys(value).length
    return (
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 3l5 5-5 5V3z" />
            </svg>
            <span className="text-sm font-medium text-foreground">{sectionKey}</span>
            <span className="text-2xs text-muted-foreground">({childCount} {childCount === 1 ? 'key' : 'keys'})</span>
          </div>
        </button>
        {expanded && (
          <div className="border-t border-border px-4 py-2 space-y-1">
            {Object.entries(value).map(([childKey, childValue]) => {
              const childPath = `${dotPath}.${childKey}`
              const childIsObject = typeof childValue === 'object' && childValue !== null

              if (childIsObject && !Array.isArray(childValue)) {
                return (
                  <NestedObject
                    key={childKey}
                    label={childKey}
                    value={childValue}
                    dotPath={childPath}
                    editingKey={editingKey}
                    editValue={editValue}
                    onStartEdit={onStartEdit}
                    onEditChange={onEditChange}
                    onSaveEdit={onSaveEdit}
                    onCancelEdit={onCancelEdit}
                  />
                )
              }

              return (
                <ConfigLeaf
                  key={childKey}
                  label={childKey}
                  value={childValue}
                  dotPath={childPath}
                  editingKey={editingKey}
                  editValue={editValue}
                  onStartEdit={onStartEdit}
                  onEditChange={onEditChange}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                />
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Top-level non-object value
  return (
    <ConfigLeaf
      label={sectionKey}
      value={value}
      dotPath={dotPath}
      editingKey={editingKey}
      editValue={editValue}
      onStartEdit={onStartEdit}
      onEditChange={onEditChange}
      onSaveEdit={onSaveEdit}
      onCancelEdit={onCancelEdit}
    />
  )
}

function NestedObject({ label, value, dotPath, editingKey, editValue, onStartEdit, onEditChange, onSaveEdit, onCancelEdit }: {
  label: string
  value: any
  dotPath: string
  editingKey: string | null
  editValue: string
  onStartEdit: (path: string, value: any) => void
  onEditChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(value)

  return (
    <div className="ml-3 border-l border-border/50 pl-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 py-1 text-sm hover:text-foreground transition-colors">
        <svg className={`w-3 h-3 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-2xs text-muted-foreground">({entries.length})</span>
      </button>
      {open && (
        <div className="space-y-1 mt-1">
          {entries.map(([k, v]) => {
            const childPath = `${dotPath}.${k}`
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              return (
                <NestedObject
                  key={k}
                  label={k}
                  value={v}
                  dotPath={childPath}
                  editingKey={editingKey}
                  editValue={editValue}
                  onStartEdit={onStartEdit}
                  onEditChange={onEditChange}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                />
              )
            }
            return (
              <ConfigLeaf
                key={k}
                label={k}
                value={v}
                dotPath={childPath}
                editingKey={editingKey}
                editValue={editValue}
                onStartEdit={onStartEdit}
                onEditChange={onEditChange}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConfigLeaf({ label, value, dotPath, editingKey, editValue, onStartEdit, onEditChange, onSaveEdit, onCancelEdit }: {
  label: string
  value: any
  dotPath: string
  editingKey: string | null
  editValue: string
  onStartEdit: (path: string, value: any) => void
  onEditChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}) {
  const isRedacted = value === '••••••••'
  const isEditing = editingKey === dotPath
  const isArray = Array.isArray(value)
  const displayValue = isArray ? JSON.stringify(value) : String(value ?? 'null')
  const typeColor = typeof value === 'boolean'
    ? value ? 'text-green-400' : 'text-red-400'
    : typeof value === 'number' ? 'text-blue-400'
    : isRedacted ? 'text-muted-foreground/50 italic'
    : 'text-foreground'

  return (
    <div className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-secondary/30 group">
      <span className="text-xs text-muted-foreground w-36 shrink-0 truncate" title={dotPath}>{label}</span>

      {isEditing ? (
        <div className="flex-1 flex items-center gap-2">
          {editValue.includes('\n') ? (
            <textarea
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              className="flex-1 px-2 py-1 text-xs font-mono bg-background border border-primary rounded-md focus:outline-none resize-y min-h-[60px]"
              autoFocus
            />
          ) : (
            <input
              type="text"
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSaveEdit()
                if (e.key === 'Escape') onCancelEdit()
              }}
              className="flex-1 px-2 py-1 text-xs font-mono bg-background border border-primary rounded-md focus:outline-none"
              autoFocus
            />
          )}
          <button onClick={onSaveEdit} className="text-green-400 hover:text-green-300 text-xs">Save</button>
          <button onClick={onCancelEdit} className="text-muted-foreground hover:text-foreground text-xs">Cancel</button>
        </div>
      ) : (
        <>
          <span className={`text-xs font-mono truncate flex-1 ${typeColor}`} title={displayValue}>
            {displayValue.length > 80 ? displayValue.slice(0, 80) + '...' : displayValue}
          </span>
          {!isRedacted && (
            <button
              onClick={() => onStartEdit(dotPath, value)}
              className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
            >
              Edit
            </button>
          )}
        </>
      )}
    </div>
  )
}
