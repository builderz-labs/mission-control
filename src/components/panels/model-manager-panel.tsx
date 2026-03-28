'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

// ── Types ──────────────────────────────────────────────────────────────────

interface ProviderConfig {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  hasApiKey?: boolean
  models?: string[]
  enabled?: boolean
}

interface HealthResult {
  provider: string
  model?: string
  status: string
  latency: number
  error?: string
}

interface HealthState {
  results: HealthResult[]
  checkedAt: number | null
  checking: boolean
}

interface ConfigData {
  providers: ProviderConfig[]
  fallback: string[]
  defaultModel: string
  hash: string
  path: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusDot(status: string | undefined) {
  const cls: Record<string, string> = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
  }
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${cls[status || ''] || 'bg-muted-foreground/40'}`}
      title={status || 'unknown'}
    />
  )
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'never'
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

const BLANK_PROVIDER: Omit<ProviderConfig, 'id'> & { id: string; apiKey: string } = {
  id: '',
  name: '',
  baseUrl: '',
  apiKey: '',
  models: [],
  enabled: true,
}

// ── Provider Form ──────────────────────────────────────────────────────────

interface ProviderFormProps {
  initial: ProviderConfig | null
  isNew: boolean
  onSave: (p: ProviderConfig & { apiKey?: string }) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function ProviderForm({ initial, isNew, onSave, onCancel, saving }: ProviderFormProps) {
  const [id, setId] = useState(initial?.id || '')
  const [name, setName] = useState(initial?.name || '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || '')
  const [apiKey, setApiKey] = useState('')
  const [modelsRaw, setModelsRaw] = useState((initial?.models || []).join('\n'))
  const [enabled, setEnabled] = useState(initial?.enabled !== false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const models = modelsRaw
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    onSave({
      id: id.trim(),
      name: name.trim(),
      baseUrl: baseUrl.trim() || undefined,
      apiKey: apiKey || undefined,
      models,
      enabled,
    })
  }

  const field = 'w-full px-3 py-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50'
  const label = 'block text-xs font-medium text-muted-foreground mb-1'

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-muted/20 border border-border rounded-lg">
      <h3 className="text-sm font-semibold">{isNew ? 'Add Provider' : 'Edit Provider'}</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Provider ID</label>
          <input
            className={field}
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="anthropic"
            disabled={!isNew}
            required
          />
          {isNew && <p className="text-xs text-muted-foreground mt-1">Lowercase, no spaces (e.g. anthropic, openai)</p>}
        </div>
        <div>
          <label className={label}>Display Name</label>
          <input
            className={field}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Anthropic"
            required
          />
        </div>
      </div>

      <div>
        <label className={label}>Base URL <span className="text-muted-foreground/60">(optional)</span></label>
        <input
          className={field}
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://api.anthropic.com/v1"
        />
      </div>

      <div>
        <label className={label}>
          API Key
          {initial?.hasApiKey && !isNew && (
            <span className="ml-1 text-muted-foreground/60">(leave blank to keep existing)</span>
          )}
        </label>
        <input
          className={field}
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={initial?.hasApiKey && !isNew ? '••••••••' : 'sk-...'}
          autoComplete="new-password"
        />
      </div>

      <div>
        <label className={label}>
          Model Aliases <span className="text-muted-foreground/60">(one per line)</span>
        </label>
        <textarea
          className={`${field} font-mono text-xs resize-none`}
          rows={4}
          value={modelsRaw}
          onChange={e => setModelsRaw(e.target.value)}
          placeholder={'sonnet\nhaiku\nopus'}
        />
        <p className="text-xs text-muted-foreground mt-1">These aliases can be referenced in the fallback chain</p>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          className="rounded"
        />
        Enabled
      </label>

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={saving || !id.trim() || !name.trim()}>
          {saving ? 'Saving...' : isNew ? 'Add Provider' : 'Save Changes'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ── Health Strip ───────────────────────────────────────────────────────────

interface HealthStripProps {
  fallback: string[]
  providers: ProviderConfig[]
  health: HealthState
  onRefresh: () => void
}

function HealthStrip({ fallback, providers, health, onRefresh }: HealthStripProps) {
  const resultMap = new Map(health.results.map(r => [r.model || r.provider, r]))

  if (fallback.length === 0 && providers.length === 0) return null

  const items = fallback.length > 0
    ? fallback
    : providers.flatMap(p => p.models || [p.id])

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Health</span>
          {health.checkedAt && (
            <span className="text-xs text-muted-foreground">Checked {relativeTime(health.checkedAt)}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={health.checking}
          className="text-xs"
        >
          {health.checking ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              Checking...
            </span>
          ) : (
            '↻ Refresh'
          )}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No models configured in fallback chain.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {items.map((alias) => {
            const r = resultMap.get(alias)
            return (
              <div
                key={alias}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-muted/40 border border-border text-xs"
                title={r?.error || r?.status || 'No data'}
              >
                {statusDot(r?.status)}
                <span className="font-mono font-medium">{alias}</span>
                {r?.latency !== undefined && r.latency > 0 && (
                  <span className="text-muted-foreground">{r.latency}ms</span>
                )}
                {r?.status === 'degraded' && r?.error && (
                  <span className="text-yellow-400 truncate max-w-[120px]" title={r.error}>!</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Fallback Chain ─────────────────────────────────────────────────────────

interface FallbackChainProps {
  fallback: string[]
  allModels: string[]
  isAdmin: boolean
  onSave: (chain: string[]) => Promise<void>
  saving: boolean
}

function FallbackChain({ fallback, allModels, isAdmin, onSave, saving }: FallbackChainProps) {
  const [chain, setChain] = useState<string[]>(fallback)
  const [dirty, setDirty] = useState(false)
  const [addAlias, setAddAlias] = useState('')

  useEffect(() => {
    setChain(fallback)
    setDirty(false)
  }, [fallback])

  function move(index: number, dir: -1 | 1) {
    const next = [...chain]
    const swap = index + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[index], next[swap]] = [next[swap], next[index]]
    setChain(next)
    setDirty(true)
  }

  function remove(index: number) {
    const next = chain.filter((_, i) => i !== index)
    setChain(next)
    setDirty(true)
  }

  function add() {
    const alias = addAlias.trim()
    if (!alias || chain.includes(alias)) return
    setChain([...chain, alias])
    setAddAlias('')
    setDirty(true)
  }

  const available = allModels.filter(m => !chain.includes(m))

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold">Fallback Chain</h2>
          <p className="text-xs text-muted-foreground">Models tried in order when the primary fails</p>
        </div>
        {isAdmin && dirty && (
          <Button
            size="sm"
            onClick={() => onSave(chain)}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Order'}
          </Button>
        )}
      </div>

      <div className="p-4 space-y-2">
        {chain.length === 0 ? (
          <p className="text-xs text-muted-foreground">No fallback chain configured.</p>
        ) : (
          chain.map((alias, i) => (
            <div
              key={`${alias}-${i}`}
              className="flex items-center gap-2 px-3 py-2 rounded bg-muted/30 border border-border group"
            >
              <span className="text-xs text-muted-foreground font-mono w-5 text-center">{i + 1}</span>
              <span className="flex-1 text-sm font-mono">{alias}</span>
              {isAdmin && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === chain.length - 1}
                    className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => remove(i)}
                    className="w-5 h-5 flex items-center justify-center text-red-400 hover:text-red-300"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))
        )}

        {isAdmin && (
          <div className="flex gap-2 pt-1">
            {available.length > 0 ? (
              <select
                value={addAlias}
                onChange={e => setAddAlias(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none"
              >
                <option value="">Add model alias...</option>
                {available.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                value={addAlias}
                onChange={e => setAddAlias(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
                placeholder="Type model alias and press Enter"
                className="flex-1 px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none"
              />
            )}
            <Button variant="outline" size="sm" onClick={add} disabled={!addAlias.trim()}>
              + Add
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────

export function ModelManagerPanel() {
  const { currentUser } = useMissionControl()
  const isAdmin = currentUser?.role === 'admin'

  const [data, setData] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthState>({ results: [], checkedAt: null, checking: false })
  const [saving, setSaving] = useState(false)
  const [savingFallback, setSavingFallback] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Provider editing
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null)
  const [addingProvider, setAddingProvider] = useState(false)

  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showFeedback(ok: boolean, text: string) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ ok, text })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000)
  }

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/models')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || `HTTP ${res.status}`)
        return
      }
      const d = await res.json()
      setData(d)
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to load config')
    } finally {
      setLoading(false)
    }
  }, [])

  const pingAll = useCallback(async () => {
    if (health.checking) return
    setHealth(h => ({ ...h, checking: true }))
    try {
      const res = await fetch('/api/models?action=ping-all', { method: 'POST' })
      if (res.ok) {
        const d = await res.json()
        setHealth({ results: d.results || [], checkedAt: d.checkedAt || Date.now(), checking: false })
      } else {
        setHealth(h => ({ ...h, checking: false }))
      }
    } catch {
      setHealth(h => ({ ...h, checking: false }))
    }
  }, [health.checking])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Auto-refresh health every 60s
  useEffect(() => {
    const id = setInterval(pingAll, 60_000)
    return () => clearInterval(id)
  }, [pingAll])

  const handleSaveProvider = useCallback(async (provider: ProviderConfig & { apiKey?: string }) => {
    if (!data) return
    setSaving(true)
    try {
      const isNew = !data.providers.find(p => p.id === provider.id)
      const providers = isNew
        ? [...data.providers, provider]
        : data.providers.map(p => p.id === provider.id ? { ...p, ...provider } : p)

      const res = await fetch('/api/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers, hash: data.hash }),
      })
      const result = await res.json()
      if (!res.ok) {
        showFeedback(false, result.error || 'Save failed')
        return
      }
      showFeedback(true, 'Provider saved')
      setEditingProvider(null)
      setAddingProvider(false)
      await fetchConfig()
    } catch (e: any) {
      showFeedback(false, e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [data, fetchConfig])

  const handleRemoveProvider = useCallback(async (id: string) => {
    if (!data) return
    if (!confirm(`Remove provider "${id}"? This cannot be undone.`)) return
    setSaving(true)
    try {
      const providers = data.providers.filter(p => p.id !== id)
      const res = await fetch('/api/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers, hash: data.hash }),
      })
      const result = await res.json()
      if (!res.ok) {
        showFeedback(false, result.error || 'Remove failed')
        return
      }
      showFeedback(true, 'Provider removed')
      await fetchConfig()
    } catch (e: any) {
      showFeedback(false, e.message || 'Remove failed')
    } finally {
      setSaving(false)
    }
  }, [data, fetchConfig])

  const handleSaveFallback = useCallback(async (chain: string[]) => {
    if (!data) return
    setSavingFallback(true)
    try {
      const res = await fetch('/api/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fallback: chain, hash: data.hash }),
      })
      const result = await res.json()
      if (!res.ok) {
        showFeedback(false, result.error || 'Save failed')
        return
      }
      showFeedback(true, 'Fallback chain saved')
      await fetchConfig()
    } catch (e: any) {
      showFeedback(false, e.message || 'Save failed')
    } finally {
      setSavingFallback(false)
    }
  }, [data, fetchConfig])

  // All model aliases across all providers
  const allModels = data
    ? [...new Set(data.providers.flatMap(p => p.models || []))]
    : []

  // ── Render ──

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
        <span className="inline-block w-4 h-4 border border-current border-t-transparent rounded-full animate-spin" />
        Loading model config...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchConfig}>Retry</Button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="p-4 space-y-5 max-w-4xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Model Manager</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Providers, fallback chain, and health monitoring from{' '}
            <span className="font-mono">{data.path.split('/').slice(-1)[0]}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchConfig}>
          ↺ Reload
        </Button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`px-3 py-2 rounded text-sm border ${
            feedback.ok
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Health Strip */}
      <HealthStrip
        fallback={data.fallback}
        providers={data.providers}
        health={health}
        onRefresh={pingAll}
      />

      {/* Providers Section */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Providers</h2>
            <p className="text-xs text-muted-foreground">{data.providers.length} configured</p>
          </div>
          {isAdmin && !addingProvider && !editingProvider && (
            <Button variant="outline" size="sm" onClick={() => setAddingProvider(true)}>
              + Add Provider
            </Button>
          )}
        </div>

        <div className="divide-y divide-border">
          {/* Add form */}
          {addingProvider && (
            <div className="p-4">
              <ProviderForm
                initial={null}
                isNew
                onSave={handleSaveProvider}
                onCancel={() => setAddingProvider(false)}
                saving={saving}
              />
            </div>
          )}

          {data.providers.length === 0 && !addingProvider && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No providers configured.{' '}
              {isAdmin && (
                <button onClick={() => setAddingProvider(true)} className="text-primary hover:underline">
                  Add one
                </button>
              )}
            </div>
          )}

          {data.providers.map(provider => (
            <div key={provider.id}>
              {editingProvider?.id === provider.id ? (
                <div className="p-4">
                  <ProviderForm
                    initial={provider}
                    isNew={false}
                    onSave={handleSaveProvider}
                    onCancel={() => setEditingProvider(null)}
                    saving={saving}
                  />
                </div>
              ) : (
                <div className="px-4 py-3 flex items-start gap-4 group hover:bg-muted/20">
                  {/* Status indicator */}
                  <div className="mt-0.5">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${provider.enabled !== false ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                      title={provider.enabled !== false ? 'Enabled' : 'Disabled'}
                    />
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{provider.name || provider.id}</span>
                      <span className="text-xs text-muted-foreground font-mono">({provider.id})</span>
                    </div>

                    {provider.baseUrl && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                        {provider.baseUrl}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">
                        Key:{' '}
                        {provider.hasApiKey ? (
                          <span className="text-foreground font-mono">{provider.apiKey}</span>
                        ) : (
                          <span className="text-muted-foreground/60">none</span>
                        )}
                      </span>

                      {provider.models && provider.models.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Models:{' '}
                          <span className="text-foreground font-mono">
                            {provider.models.join(', ')}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditingProvider(provider); setAddingProvider(false) }}
                        className="text-xs h-7"
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveProvider(provider.id)}
                        className="text-xs h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Fallback Chain */}
      <FallbackChain
        fallback={data.fallback}
        allModels={allModels}
        isAdmin={isAdmin}
        onSave={handleSaveFallback}
        saving={savingFallback}
      />

      {/* Default Model */}
      {data.defaultModel && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <span>Default agent model:</span>
          <span className="font-mono text-foreground">{data.defaultModel}</span>
        </div>
      )}
    </div>
  )
}
