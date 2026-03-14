'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { schemaType, normalizeSchema, extractSchemaTags } from '@/lib/config-schema-utils'
import type { JsonSchema } from '@/lib/config-schema-utils'

type FormMode = 'form' | 'json'

type Feedback = { ok: boolean; text: string } | null

// ── Section metadata ───────────────────────────────────────────────────────

const SECTION_META: Record<string, { label: string; icon: string }> = {
  gateway: { label: 'Gateway', icon: 'G' },
  agents: { label: 'Agents', icon: 'A' },
  channels: { label: 'Channels', icon: 'C' },
  auth: { label: 'Authentication', icon: 'K' },
  tools: { label: 'Tools', icon: 'T' },
  skills: { label: 'Skills', icon: 'S' },
  hooks: { label: 'Hooks', icon: 'H' },
  commands: { label: 'Commands', icon: '>' },
  messages: { label: 'Messages', icon: 'M' },
  models: { label: 'Models', icon: 'D' },
  env: { label: 'Environment', icon: 'E' },
  update: { label: 'Updates', icon: 'U' },
  logging: { label: 'Logging', icon: 'L' },
  browser: { label: 'Browser', icon: 'B' },
  session: { label: 'Session', icon: 'P' },
  cron: { label: 'Cron', icon: 'R' },
  web: { label: 'Web', icon: 'W' },
  ui: { label: 'UI', icon: 'I' },
  broadcast: { label: 'Broadcast', icon: 'N' },
  plugins: { label: 'Plugins', icon: 'X' },
  wizard: { label: 'Setup Wizard', icon: 'Z' },
  meta: { label: 'Metadata', icon: 'F' },
}

const TAG_PRESETS = ['security', 'auth', 'network', 'performance', 'advanced'] as const

// ── Schema helpers ─────────────────────────────────────────────────────────

function humanize(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^./, m => m.toUpperCase())
}

function defaultValueFor(schema?: JsonSchema): unknown {
  if (!schema) return ''
  if (schema.default !== undefined) return schema.default
  const t = schemaType(schema)
  switch (t) {
    case 'object': return {}
    case 'array': return []
    case 'boolean': return false
    case 'number': case 'integer': return 0
    case 'string': return ''
    default: return ''
  }
}

/** Deep set a value at a path in an object, returning a new object */
function deepSet(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return obj
  const [head, ...tail] = path
  const current = obj[head]
  if (tail.length === 0) {
    return { ...obj, [head]: value }
  }
  const child = (current && typeof current === 'object' && !Array.isArray(current))
    ? current as Record<string, unknown>
    : {}
  return { ...obj, [head]: deepSet(child, tail, value) }
}

/** Get a value at a path in an object */
function deepGet(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const collectTags = extractSchemaTags

/** Check if a field matches search query */
function matchesSearch(key: string, schema: JsonSchema, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (key.toLowerCase().includes(q)) return true
  if (schema.title?.toLowerCase().includes(q)) return true
  if (schema.description?.toLowerCase().includes(q)) return true
  const schemaTags = (schema['x-tags'] ?? schema.tags ?? []) as string[]
  if (schemaTags.some(t => typeof t === 'string' && t.toLowerCase().includes(q))) return true
  // Check children
  if (schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      if (matchesSearch(k, v, query)) return true
    }
  }
  return false
}

// ── Diff computation ───────────────────────────────────────────────────────

type DiffEntry = { path: string; from: unknown; to: unknown }

function computeDiff(original: unknown, current: unknown, path = ''): DiffEntry[] {
  if (original === current) return []
  if (typeof original !== typeof current) return [{ path, from: original, to: current }]
  if (typeof original !== 'object' || original === null || current === null) {
    return original !== current ? [{ path, from: original, to: current }] : []
  }
  if (Array.isArray(original) && Array.isArray(current)) {
    if (JSON.stringify(original) !== JSON.stringify(current)) {
      return [{ path, from: original, to: current }]
    }
    return []
  }
  const origObj = original as Record<string, unknown>
  const currObj = current as Record<string, unknown>
  const allKeys = new Set([...Object.keys(origObj), ...Object.keys(currObj)])
  const diffs: DiffEntry[] = []
  for (const key of allKeys) {
    diffs.push(...computeDiff(origObj[key], currObj[key], path ? `${path}.${key}` : key))
  }
  return diffs
}

// ── Main Panel ─────────────────────────────────────────────────────────────

export function GatewayConfigPanel() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [originalConfig, setOriginalConfig] = useState<Record<string, unknown> | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [configHash, setConfigHash] = useState<string | null>(null)
  const [schema, setSchema] = useState<JsonSchema | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [mode, setMode] = useState<FormMode>('form')
  const [jsonText, setJsonText] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [updating, setUpdating] = useState(false)

  const showFeedback = useCallback((ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 4000)
  }, [])

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/gateway-config')
      if (res.status === 403) { setError('Admin access required'); return }
      if (res.status === 404) {
        const data = await res.json()
        setError(data.error || 'Config not found')
        return
      }
      if (!res.ok) { setError('Failed to load config'); return }
      const data = await res.json()
      setConfig(data.config)
      setOriginalConfig(data.config)
      setConfigPath(data.path)
      setConfigHash(data.hash ?? null)
      setJsonText(JSON.stringify(data.config, null, 2))
      setError(null)
    } catch {
      setError('Failed to load gateway config')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSchema = useCallback(async () => {
    setSchemaLoading(true)
    try {
      const res = await fetch('/api/gateway-config?action=schema')
      if (res.ok) {
        const data = await res.json()
        setSchema(data.schema ?? data)
      }
    } catch {
      // Schema is optional - form still works without it
    } finally {
      setSchemaLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig(); fetchSchema() }, [fetchConfig, fetchSchema])

  // Derive sections from schema or config
  const sections = useMemo(() => {
    const keys = new Set<string>()
    if (schema?.properties) {
      for (const k of Object.keys(schema.properties)) keys.add(k)
    }
    if (config) {
      for (const k of Object.keys(config)) keys.add(k)
    }
    return [...keys].sort((a, b) => {
      const aMeta = SECTION_META[a]
      const bMeta = SECTION_META[b]
      if (aMeta && !bMeta) return -1
      if (!aMeta && bMeta) return 1
      return a.localeCompare(b)
    })
  }, [schema, config])

  // Filter sections by search
  const filteredSections = useMemo(() => {
    if (!searchQuery) return sections
    return sections.filter(key => {
      const sectionSchema = schema?.properties?.[key]
      if (sectionSchema && matchesSearch(key, sectionSchema, searchQuery)) return true
      const meta = SECTION_META[key]
      if (meta && meta.label.toLowerCase().includes(searchQuery.toLowerCase())) return true
      return key.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [sections, searchQuery, schema])

  const diff = useMemo(() => {
    if (mode === 'json') return []
    return computeDiff(originalConfig, config)
  }, [originalConfig, config, mode])

  const hasChanges = mode === 'json'
    ? jsonText !== JSON.stringify(originalConfig, null, 2)
    : diff.length > 0

  const handlePatch = useCallback((path: string[], value: unknown) => {
    setConfig(prev => prev ? deepSet(prev, path, value) : prev)
  }, [])

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving) return
    setSaving(true)

    try {
      let updates: Record<string, unknown> = {}

      if (mode === 'json') {
        try {
          const parsed = JSON.parse(jsonText)
          // Convert full config to flat dot-notation updates
          function flatten(obj: Record<string, unknown>, prefix = '') {
            for (const [k, v] of Object.entries(obj)) {
              const path = prefix ? `${prefix}.${k}` : k
              if (v && typeof v === 'object' && !Array.isArray(v)) {
                flatten(v as Record<string, unknown>, path)
              } else {
                updates[path] = v
              }
            }
          }
          flatten(parsed)
        } catch {
          showFeedback(false, 'Invalid JSON')
          setSaving(false)
          return
        }
      } else {
        for (const d of diff) {
          updates[d.path] = d.to
        }
      }

      const res = await fetch('/api/gateway-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, hash: configHash }),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} field${data.count !== 1 ? 's' : ''}`)
        setConfigHash(data.hash ?? null)
        fetchConfig()
      } else if (res.status === 409) {
        showFeedback(false, data.error || 'Conflict - please reload')
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }, [hasChanges, saving, mode, jsonText, diff, configHash, showFeedback, fetchConfig])

  const handleApply = useCallback(async () => {
    if (applying) return
    setApplying(true)
    try {
      // Save first if there are changes
      if (hasChanges) {
        await handleSave()
      }
      const res = await fetch('/api/gateway-config?action=apply', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, 'Config applied (hot reload)')
      } else {
        showFeedback(false, data.error || 'Apply failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setApplying(false)
    }
  }, [applying, hasChanges, handleSave, showFeedback])

  const handleUpdate = useCallback(async () => {
    if (updating) return
    setUpdating(true)
    try {
      const res = await fetch('/api/gateway-config?action=update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, 'System update initiated')
      } else {
        showFeedback(false, data.error || 'Update failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setUpdating(false)
    }
  }, [updating, showFeedback])

  const t = useTranslations('gatewayConfig')

  // Loading state
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t('loading')}</span>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
        <p className="text-xs text-muted-foreground mt-2">
          {t('configPathHint')}
        </p>
      </div>
    )
  }

  const visibleSections = activeSection ? [activeSection] : filteredSections

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-border bg-card/50 flex flex-col overflow-hidden">
        <div className="px-3 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-foreground">{t('sidebarTitle')}</h2>
          <p className="text-2xs text-muted-foreground mt-0.5 truncate font-mono">{configPath}</p>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="relative">
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full h-7 pl-7 pr-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <svg className="absolute left-2 top-1.5 w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground text-xs"
              >x</button>
            )}
          </div>
          {/* Tag chips */}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {TAG_PRESETS.map(tag => (
              <button
                key={tag}
                onClick={() => setSearchQuery(prev =>
                  prev.includes(`tag:${tag}`)
                    ? prev.replace(`tag:${tag}`, '').trim()
                    : `${prev} tag:${tag}`.trim()
                )}
                className={`text-2xs px-1.5 py-0.5 rounded border transition-colors ${
                  searchQuery.includes(`tag:${tag}`)
                    ? 'bg-primary/20 border-primary/40 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80'
                }`}
              >{tag}</button>
            ))}
          </div>
        </div>

        {/* Section nav */}
        <nav className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-0.5">
          <button
            onClick={() => setActiveSection(null)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
              activeSection === null
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded bg-secondary text-2xs font-bold">*</span>
            <span>{t('allSettings')}</span>
          </button>
          {sections.map(key => {
            const meta = SECTION_META[key] ?? { label: humanize(key), icon: key[0].toUpperCase() }
            const isActive = activeSection === key
            const matchesFilter = filteredSections.includes(key)
            if (!matchesFilter && searchQuery) return null
            return (
              <button
                key={key}
                onClick={() => setActiveSection(isActive ? null : key)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded bg-secondary text-2xs font-bold">{meta.icon}</span>
                <span className="truncate">{meta.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Mode toggle */}
        <div className="px-3 py-2 border-t border-border">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => {
                if (mode === 'json' && config) {
                  // Sync JSON back to form
                  try { setConfig(JSON.parse(jsonText)) } catch { /* keep current */ }
                }
                setMode('form')
              }}
              className={`flex-1 text-xs py-1.5 transition-colors ${
                mode === 'form' ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >{t('modeForm')}</button>
            <button
              onClick={() => {
                if (mode === 'form' && config) {
                  setJsonText(JSON.stringify(config, null, 2))
                }
                setMode('json')
              }}
              className={`flex-1 text-xs py-1.5 transition-colors border-l border-border ${
                mode === 'json' ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >{t('modeJson')}</button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Action bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/30">
          <div className="flex items-center gap-2">
            {hasChanges ? (
              <span className="text-xs font-medium text-amber-400">
                {mode === 'json' ? t('unsavedChanges') : t('unsavedChangesCount', { count: diff.length })}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t('noChanges')}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => { fetchConfig(); fetchSchema() }}
              disabled={loading}
            >{t('reload')}</Button>
            <Button
              variant="default"
              size="xs"
              onClick={handleSave}
              disabled={!hasChanges || saving}
            >{saving ? t('saving') : t('save')}</Button>
            <Button
              variant="outline"
              size="xs"
              onClick={handleApply}
              disabled={applying}
            >{applying ? t('applying') : t('apply')}</Button>
            <Button
              variant="outline"
              size="xs"
              onClick={handleUpdate}
              disabled={updating}
            >{updating ? t('updating') : t('updateSystem')}</Button>
          </div>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`mx-4 mt-2 rounded-lg p-2.5 text-xs font-medium ${
            feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
          }`}>
            {feedback.text}
          </div>
        )}

        {/* Diff summary */}
        {hasChanges && mode === 'form' && diff.length > 0 && (
          <details className="mx-4 mt-2 border border-amber-500/20 rounded-lg">
            <summary className="px-3 py-1.5 text-xs text-amber-400 cursor-pointer hover:bg-amber-500/5">
              {t('viewPendingChanges', { count: diff.length })}
            </summary>
            <div className="px-3 py-2 space-y-1 border-t border-amber-500/10">
              {diff.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-2xs">
                  <span className="font-mono text-muted-foreground">{d.path}</span>
                  <span className="text-red-400 truncate max-w-24">{truncateValue(d.from)}</span>
                  <span className="text-muted-foreground">-&gt;</span>
                  <span className="text-green-400 truncate max-w-24">{truncateValue(d.to)}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {mode === 'json' ? (
            <textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              className="w-full h-full min-h-[500px] p-3 text-xs font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
              spellCheck={false}
            />
          ) : (
            <>
              {schemaLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  {t('loadingSchema')}
                </div>
              )}
              {config && visibleSections.map(sectionKey => {
                const sectionSchema = schema?.properties?.[sectionKey]
                const sectionValue = config[sectionKey]
                if (sectionValue === undefined && !sectionSchema) return null
                const meta = SECTION_META[sectionKey] ?? { label: humanize(sectionKey), icon: sectionKey[0].toUpperCase() }

                return (
                  <SectionCard
                    key={sectionKey}
                    sectionKey={sectionKey}
                    label={meta.label}
                    icon={meta.icon}
                    description={sectionSchema?.description}
                    schema={sectionSchema}
                    value={sectionValue}
                    searchQuery={searchQuery}
                    onPatch={(path, value) => handlePatch([sectionKey, ...path], value)}
                  />
                )
              })}
              {visibleSections.length === 0 && (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {t('noSettingsMatch', { query: searchQuery })}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// ── Section Card ───────────────────────────────────────────────────────────

function SectionCard({ sectionKey, label, icon, description, schema, value, searchQuery, onPatch }: {
  sectionKey: string
  label: string
  icon: string
  description?: string
  schema?: JsonSchema
  value: unknown
  searchQuery: string
  onPatch: (path: string[], value: unknown) => void
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors"
      >
        <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-bold">{icon}</span>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {description && <div className="text-2xs text-muted-foreground mt-0.5">{description}</div>}
        </div>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {schema && schemaType(schema) === 'object' && schema.properties ? (
            // Schema-driven rendering
            Object.entries(schema.properties).map(([key, fieldSchema]) => {
              if (searchQuery && !matchesSearch(key, fieldSchema, searchQuery)) return null
              const fieldValue = value && typeof value === 'object'
                ? (value as Record<string, unknown>)[key]
                : undefined
              return (
                <SchemaField
                  key={key}
                  fieldKey={key}
                  schema={normalizeSchema(fieldSchema)}
                  value={fieldValue}
                  path={[key]}
                  onPatch={onPatch}
                />
              )
            })
          ) : value && typeof value === 'object' && !Array.isArray(value) ? (
            // Fallback: render from value without schema
            Object.entries(value as Record<string, unknown>).map(([key, val]) => {
              if (searchQuery && !key.toLowerCase().includes(searchQuery.toLowerCase())) return null
              return (
                <FallbackField
                  key={key}
                  fieldKey={key}
                  value={val}
                  path={[key]}
                  onPatch={onPatch}
                />
              )
            })
          ) : (
            <FallbackField
              fieldKey={sectionKey}
              value={value}
              path={[]}
              onPatch={onPatch}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Schema-Driven Field ────────────────────────────────────────────────────

function SchemaField({ fieldKey, schema, value, path, onPatch }: {
  fieldKey: string
  schema: JsonSchema
  value: unknown
  path: string[]
  onPatch: (path: string[], value: unknown) => void
}) {
  const type = schemaType(schema)
  const label = schema.title ?? humanize(fieldKey)
  const help = schema.description
  const isRedacted = value === '--------'

  // Enum -> select dropdown
  if (schema.enum && schema.enum.length > 0) {
    return (
      <FieldWrapper label={label} help={help} path={path}>
        <select
          value={value != null ? String(value) : ''}
          onChange={e => {
            const selected = schema.enum!.find(opt => String(opt) === e.target.value)
            onPatch(path, selected ?? e.target.value)
          }}
          className="h-8 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-40"
        >
          <option value="">Select...</option>
          {schema.enum.map((opt, i) => (
            <option key={i} value={String(opt)}>{String(opt)}</option>
          ))}
        </select>
      </FieldWrapper>
    )
  }

  // Boolean -> toggle switch
  if (type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : (schema.default === true)
    return (
      <label className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-secondary/30 cursor-pointer group">
        <div className="flex-1">
          <div className="text-xs font-medium text-foreground">{label}</div>
          {help && <div className="text-2xs text-muted-foreground mt-0.5">{help}</div>}
        </div>
        <div className="relative">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onPatch(path, e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-secondary rounded-full peer-checked:bg-primary/60 transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-foreground rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </div>
      </label>
    )
  }

  // Number / Integer -> number input
  if (type === 'number' || type === 'integer') {
    const numValue = typeof value === 'number' ? value : (typeof schema.default === 'number' ? schema.default : '')
    return (
      <FieldWrapper label={label} help={help} path={path}>
        <input
          type="number"
          value={numValue}
          min={schema.minimum}
          max={schema.maximum}
          onChange={e => {
            const raw = e.target.value
            if (raw === '') { onPatch(path, undefined); return }
            const num = Number(raw)
            onPatch(path, Number.isNaN(num) ? raw : (type === 'integer' ? Math.floor(num) : num))
          }}
          className="h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 w-32"
        />
      </FieldWrapper>
    )
  }

  // String -> text input
  if (type === 'string') {
    const strValue = value != null ? String(value) : ''
    return (
      <FieldWrapper label={label} help={help} path={path}>
        <input
          type={isRedacted ? 'password' : 'text'}
          value={strValue}
          placeholder={schema.default != null ? `Default: ${String(schema.default)}` : ''}
          disabled={isRedacted}
          onChange={e => onPatch(path, e.target.value)}
          className="h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 flex-1 min-w-40 disabled:opacity-50"
        />
      </FieldWrapper>
    )
  }

  // Array -> array editor
  if (type === 'array') {
    const arr = Array.isArray(value) ? value : (Array.isArray(schema.default) ? schema.default : [])
    const itemsSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items
    return (
      <ArrayField
        label={label}
        help={help}
        items={arr}
        itemSchema={itemsSchema}
        path={path}
        onPatch={onPatch}
      />
    )
  }

  // Object -> collapsible section with nested fields
  if (type === 'object') {
    return (
      <ObjectField
        fieldKey={fieldKey}
        label={label}
        help={help}
        schema={schema}
        value={value}
        path={path}
        onPatch={onPatch}
      />
    )
  }

  // Fallback for unknown types
  return (
    <FallbackField
      fieldKey={fieldKey}
      value={value}
      path={path}
      onPatch={onPatch}
    />
  )
}

// ── Field Wrapper ──────────────────────────────────────────────────────────

function FieldWrapper({ label, help, path, children }: {
  label: string
  help?: string
  path: string[]
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-1.5 px-2 rounded hover:bg-secondary/30">
      <div className="w-40 shrink-0 pt-1.5">
        <div className="text-xs font-medium text-foreground truncate" title={path.join('.')}>{label}</div>
        {help && <div className="text-2xs text-muted-foreground mt-0.5 line-clamp-2">{help}</div>}
      </div>
      <div className="flex-1 flex items-start">
        {children}
      </div>
    </div>
  )
}

// ── Object Field (collapsible) ─────────────────────────────────────────────

function ObjectField({ fieldKey, label, help, schema, value, path, onPatch }: {
  fieldKey: string
  label: string
  help?: string
  schema: JsonSchema
  value: unknown
  path: string[]
  onPatch: (path: string[], value: unknown) => void
}) {
  const [open, setOpen] = useState(path.length <= 1)
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const properties = schema.properties ?? {}
  const entries = Object.entries(properties)
  const entryCount = entries.length || Object.keys(obj).length

  return (
    <div className="ml-2 border-l-2 border-border/40 pl-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 py-1 text-xs hover:text-foreground transition-colors"
      >
        <svg
          className={`w-3 h-3 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 16 16" fill="currentColor"
        >
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-2xs text-muted-foreground">({entryCount})</span>
      </button>
      {help && open && <div className="text-2xs text-muted-foreground ml-5 mb-1">{help}</div>}
      {open && (
        <div className="space-y-1 mt-1">
          {entries.length > 0 ? (
            entries.map(([key, fieldSchema]) => (
              <SchemaField
                key={key}
                fieldKey={key}
                schema={normalizeSchema(fieldSchema)}
                value={obj[key]}
                path={[...path, key]}
                onPatch={onPatch}
              />
            ))
          ) : (
            // Render from value if no schema properties
            Object.entries(obj).map(([key, val]) => (
              <FallbackField
                key={key}
                fieldKey={key}
                value={val}
                path={[...path, key]}
                onPatch={onPatch}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Array Field ────────────────────────────────────────────────────────────

function ArrayField({ label, help, items, itemSchema, path, onPatch }: {
  label: string
  help?: string
  items: unknown[]
  itemSchema?: JsonSchema
  path: string[]
  onPatch: (path: string[], value: unknown) => void
}) {
  return (
    <div className="ml-2 border-l-2 border-border/40 pl-3 py-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-2xs text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            const newItem = defaultValueFor(itemSchema)
            onPatch(path, [...items, newItem])
          }}
          className="ml-auto text-2xs"
        >+ Add</Button>
      </div>
      {help && <div className="text-2xs text-muted-foreground mb-1">{help}</div>}
      {items.length === 0 ? (
        <div className="text-2xs text-muted-foreground py-2">No items.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-2 items-start bg-secondary/20 rounded p-2">
              <span className="text-2xs text-muted-foreground pt-1.5 w-6 shrink-0">#{idx + 1}</span>
              <div className="flex-1">
                {itemSchema && schemaType(normalizeSchema(itemSchema)) === 'object' ? (
                  <SchemaField
                    fieldKey={String(idx)}
                    schema={normalizeSchema(itemSchema)}
                    value={item}
                    path={[...path, String(idx)]}
                    onPatch={(fieldPath, value) => {
                      // For array items, we need to reconstruct the full array
                      const next = [...items]
                      if (fieldPath.length > path.length + 1) {
                        // Nested patch within array item
                        const itemPath = fieldPath.slice(path.length + 1)
                        const itemObj = (typeof item === 'object' && item !== null) ? { ...item as Record<string, unknown> } : {}
                        next[idx] = deepSet(itemObj, itemPath, value)
                      } else {
                        next[idx] = value
                      }
                      onPatch(path, next)
                    }}
                  />
                ) : itemSchema ? (
                  <SchemaField
                    fieldKey={String(idx)}
                    schema={normalizeSchema(itemSchema)}
                    value={item}
                    path={[...path, String(idx)]}
                    onPatch={(_, value) => {
                      const next = [...items]
                      next[idx] = value
                      onPatch(path, next)
                    }}
                  />
                ) : (
                  <FallbackField
                    fieldKey={String(idx)}
                    value={item}
                    path={[...path, String(idx)]}
                    onPatch={(_, value) => {
                      const next = [...items]
                      next[idx] = value
                      onPatch(path, next)
                    }}
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="text-red-400 hover:text-red-300 shrink-0"
                onClick={() => {
                  const next = [...items]
                  next.splice(idx, 1)
                  onPatch(path, next)
                }}
              >Del</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Fallback Field (no schema) ─────────────────────────────────────────────

function FallbackField({ fieldKey, value, path, onPatch }: {
  fieldKey: string
  value: unknown
  path: string[]
  onPatch: (path: string[], value: unknown) => void
}) {
  const isRedacted = value === '--------'
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
  const isArray = Array.isArray(value)

  if (isObject) {
    return (
      <ObjectField
        fieldKey={fieldKey}
        label={humanize(fieldKey)}
        schema={{ type: 'object', properties: {} }}
        value={value}
        path={path}
        onPatch={onPatch}
      />
    )
  }

  if (isArray) {
    return (
      <ArrayField
        label={humanize(fieldKey)}
        items={value}
        path={path}
        onPatch={onPatch}
      />
    )
  }

  const displayValue = String(value ?? '')
  const isBool = typeof value === 'boolean'
  const isNum = typeof value === 'number'

  if (isBool) {
    return (
      <label className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-secondary/30 cursor-pointer">
        <span className="text-xs text-foreground">{humanize(fieldKey)}</span>
        <div className="relative">
          <input
            type="checkbox"
            checked={value}
            onChange={e => onPatch(path, e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-secondary rounded-full peer-checked:bg-primary/60 transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-foreground rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </div>
      </label>
    )
  }

  return (
    <FieldWrapper label={humanize(fieldKey)} path={path}>
      <input
        type={isNum ? 'number' : isRedacted ? 'password' : 'text'}
        value={displayValue}
        disabled={isRedacted}
        onChange={e => {
          const raw = e.target.value
          if (isNum) {
            const num = Number(raw)
            onPatch(path, Number.isNaN(num) ? raw : num)
          } else {
            onPatch(path, raw)
          }
        }}
        className="h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 flex-1 min-w-40 disabled:opacity-50"
      />
    </FieldWrapper>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncateValue(value: unknown, maxLen = 30): string {
  try {
    const str = JSON.stringify(value) ?? String(value)
    return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + '...'
  } catch {
    return String(value)
  }
}
