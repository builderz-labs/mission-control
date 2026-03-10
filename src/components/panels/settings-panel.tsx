'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'

interface Setting {
  key: string
  value: string
  description: string
  category: string
  updated_by: string | null
  updated_at: number | null
  is_default: boolean
}

interface Credential {
  id: number
  name: string
  type: string
  value: string
  description: string | null
  created_at: number
  updated_at: number
}

const CRED_TYPES = ['api_key', 'email', 'url', 'secret', 'other'] as const
const TYPE_LABELS: Record<string, string> = { api_key: 'API Key', email: 'Email', url: 'URL', secret: 'Secret', other: 'Other' }

const categoryLabels: Record<string, { label: string; icon: string; description: string }> = {
  general: { label: 'General', icon: '⚙', description: 'Core Mission Control settings' },
  retention: { label: 'Data Retention', icon: '🗄', description: 'How long data is kept before cleanup' },
  gateway: { label: 'Gateway', icon: '🔌', description: 'OpenClaw gateway connection settings' },
  custom: { label: 'Custom', icon: '🔧', description: 'User-defined settings' },
}

const categoryOrder = ['general', 'retention', 'gateway', 'custom']

export function SettingsPanel() {
  const { currentUser } = useMissionControl()
  const [settings, setSettings] = useState<Setting[]>([])
  const [grouped, setGrouped] = useState<Record<string, Setting[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [activeCategory, setActiveCategory] = useState('general')

  // Credentials state
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [credLoading, setCredLoading] = useState(false)
  const [showAddCred, setShowAddCred] = useState(false)
  const [newCred, setNewCred] = useState({ name: '', type: 'api_key', value: '', description: '' })
  const [credSaving, setCredSaving] = useState(false)
  const [revealedId, setRevealedId] = useState<number | null>(null)
  const [revealedValue, setRevealedValue] = useState('')

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.status === 403) { setError('Admin access required'); return }
      if (!res.ok) { setError('Failed to load settings'); return }
      const data = await res.json()
      setSettings(data.settings || [])
      setGrouped(data.grouped || {})
    } catch { setError('Failed to load settings') }
    finally { setLoading(false) }
  }, [])

  const fetchCredentials = useCallback(async () => {
    setCredLoading(true)
    try {
      const res = await fetch('/api/credentials')
      if (res.ok) setCredentials((await res.json()).credentials || [])
    } catch { /* ignore */ }
    finally { setCredLoading(false) }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])
  useEffect(() => { if (activeCategory === 'credentials') fetchCredentials() }, [activeCategory, fetchCredentials])

  const handleEdit = (key: string, value: string) => setEdits(prev => ({ ...prev, [key]: value }))

  const hasChanges = Object.keys(edits).some(key => {
    const setting = settings.find(s => s.key === key)
    return setting && edits[key] !== setting.value
  })

  const handleSave = async () => {
    const changes: Record<string, string> = {}
    for (const [key, value] of Object.entries(edits)) {
      const setting = settings.find(s => s.key === key)
      if (setting && value !== setting.value) changes[key] = value
    }
    if (Object.keys(changes).length === 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: changes }) })
      const data = await res.json()
      if (res.ok) { showFeedback(true, `Saved ${data.count} setting${data.count === 1 ? '' : 's'}`); setEdits({}); fetchSettings() }
      else showFeedback(false, data.error || 'Failed to save')
    } catch { showFeedback(false, 'Network error') }
    finally { setSaving(false) }
  }

  const handleReset = async (key: string) => {
    try {
      const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) { showFeedback(true, `Reset "${key}" to default`); setEdits(prev => { const n = { ...prev }; delete n[key]; return n }); fetchSettings() }
      else showFeedback(false, data.error || 'Failed to reset')
    } catch { showFeedback(false, 'Network error') }
  }

  const handleAddCredential = async () => {
    if (!newCred.name.trim() || !newCred.value.trim()) return
    setCredSaving(true)
    try {
      const res = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCred) })
      const data = await res.json()
      if (res.ok) {
        setCredentials(prev => [data.credential, ...prev])
        setNewCred({ name: '', type: 'api_key', value: '', description: '' })
        setShowAddCred(false)
        showFeedback(true, 'Credential saved')
      } else showFeedback(false, data.error || 'Failed to save')
    } catch { showFeedback(false, 'Network error') }
    finally { setCredSaving(false) }
  }

  const handleDeleteCredential = async (id: number) => {
    if (!confirm('Delete this credential?')) return
    try {
      const res = await fetch(`/api/credentials/${id}`, { method: 'DELETE' })
      if (res.ok) { setCredentials(prev => prev.filter(c => c.id !== id)); showFeedback(true, 'Deleted') }
      else showFeedback(false, 'Failed to delete')
    } catch { showFeedback(false, 'Network error') }
  }

  const handleReveal = async (id: number) => {
    if (revealedId === id) { setRevealedId(null); setRevealedValue(''); return }
    try {
      const res = await fetch(`/api/credentials/${id}`)
      if (res.ok) { const { value } = await res.json(); setRevealedId(id); setRevealedValue(value) }
    } catch { /* ignore */ }
  }

  const handleCopy = async (id: number, maskedValue: string) => {
    try {
      let val = revealedId === id ? revealedValue : null
      if (!val) {
        const res = await fetch(`/api/credentials/${id}`)
        if (res.ok) val = (await res.json()).value
      }
      if (val) { await navigator.clipboard.writeText(val); showFeedback(true, 'Copied!') }
    } catch { showFeedback(false, 'Copy failed') }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading settings...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
      </div>
    )
  }

  const settingCategories = categoryOrder.filter(c => grouped[c]?.length > 0)
  const allTabs = [...settingCategories, 'credentials']
  const orchestratorIdleSetting = settings.find(s => s.key === 'general.orchestrator_set_idle_after_run')
  const orchestratorIdleValue = edits['general.orchestrator_set_idle_after_run'] ?? orchestratorIdleSetting?.value ?? 'true'

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Configure Mission Control and manage credentials</p>
        </div>
        {activeCategory !== 'credentials' && (
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button onClick={() => setEdits({})} className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors">
                Discard
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={`px-4 py-1.5 text-xs rounded-md font-medium transition-colors ${hasChanges ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
        {activeCategory === 'credentials' && (
          <button
            onClick={() => setShowAddCred(true)}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors"
          >
            + Add Credential
          </button>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'}`}>
          {feedback.text}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-border pb-px overflow-x-auto">
        {allTabs.map(cat => {
          const meta = cat === 'credentials'
            ? { label: 'Credentials', icon: '🔑' }
            : (categoryLabels[cat] || { label: cat, icon: '📋' })
          const changedCount = cat !== 'credentials'
            ? (grouped[cat] || []).filter(s => edits[s.key] !== undefined && edits[s.key] !== s.value).length
            : 0
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-2 text-xs font-medium rounded-t-md transition-colors relative whitespace-nowrap ${
                activeCategory === cat ? 'bg-card text-foreground border border-border border-b-card -mb-px' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {meta.label}
              {changedCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-2xs rounded-full bg-primary text-primary-foreground">
                  {changedCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Credentials tab content */}
      {activeCategory === 'credentials' && (
        <div className="space-y-3">
          {/* Add credential form */}
          {showAddCred && (
            <div className="bg-card border border-primary/50 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-foreground">New Credential</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. OpenAI Production Key"
                    value={newCred.name}
                    onChange={e => setNewCred(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                  <select
                    value={newCred.type}
                    onChange={e => setNewCred(p => ({ ...p, type: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                  >
                    {CRED_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Value *</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={newCred.value}
                  onChange={e => setNewCred(p => ({ ...p, value: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                <input
                  type="text"
                  placeholder="Optional note"
                  value={newCred.description}
                  onChange={e => setNewCred(p => ({ ...p, description: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAddCred(false)} className="px-3 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
                <button
                  onClick={handleAddCredential}
                  disabled={credSaving || !newCred.name.trim() || !newCred.value.trim()}
                  className="px-4 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium disabled:opacity-50"
                >
                  {credSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {credLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading credentials...
            </div>
          )}

          {!credLoading && credentials.length === 0 && !showAddCred && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No credentials saved. Click &quot;+ Add Credential&quot; to store an API key or email.
            </div>
          )}

          {credentials.map(cred => (
            <div key={cred.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{cred.name}</span>
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                      {TYPE_LABELS[cred.type] || cred.type}
                    </span>
                  </div>
                  {cred.description && <p className="text-xs text-muted-foreground mt-0.5">{cred.description}</p>}
                  <div className="mt-1.5 font-mono text-xs text-muted-foreground bg-background border border-border rounded px-2 py-1">
                    {revealedId === cred.id ? revealedValue : cred.value}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleReveal(cred.id)}
                    title={revealedId === cred.id ? 'Hide' : 'Reveal'}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {revealedId === cred.id ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/><line x1="2" y1="2" x2="14" y2="14"/></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg>
                    )}
                  </button>
                  <button
                    onClick={() => handleCopy(cred.id, cred.value)}
                    title="Copy value"
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3 11V3a1 1 0 011-1h8"/></svg>
                  </button>
                  <button
                    onClick={() => handleDeleteCredential(cred.id)}
                    title="Delete"
                    className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h10M6 4V3h4v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4"/></svg>
                  </button>
                </div>
              </div>
              <div className="text-2xs text-muted-foreground/50 mt-2">
                Added {new Date(cred.created_at * 1000).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Settings list for active category */}
      {activeCategory !== 'credentials' && (
        <div className="space-y-3">
          {activeCategory === 'general' && orchestratorIdleSetting && (
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Orchestrator Team Presence</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Keep orchestrator team agents in <span className="font-mono">idle</span> after a run instead of forcing <span className="font-mono">offline</span>.
                  </p>
                </div>
                <button
                  onClick={() => handleEdit('general.orchestrator_set_idle_after_run', orchestratorIdleValue === 'true' ? 'false' : 'true')}
                  className={`w-11 h-6 rounded-full relative transition-colors ${orchestratorIdleValue === 'true' ? 'bg-primary' : 'bg-muted'}`}
                  title="Toggle orchestrator post-run behavior"
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${orchestratorIdleValue === 'true' ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          )}

          {(grouped[activeCategory] || []).map(setting => {
            const currentValue = edits[setting.key] ?? setting.value
            const isChanged = edits[setting.key] !== undefined && edits[setting.key] !== setting.value
            const isBooleanish = setting.value === 'true' || setting.value === 'false'
            const isNumeric = /^\d+$/.test(setting.value)
            const shortKey = setting.key.split('.').pop() || setting.key

            return (
              <div key={setting.key} className={`bg-card border rounded-lg p-4 transition-colors ${isChanged ? 'border-primary/50' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{formatLabel(shortKey)}</span>
                      {setting.is_default && <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">default</span>}
                      {isChanged && <span className="text-2xs px-1.5 py-0.5 rounded bg-primary/15 text-primary">modified</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
                    <p className="text-2xs text-muted-foreground/60 mt-1 font-mono">{setting.key}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isBooleanish ? (
                      <button
                        onClick={() => handleEdit(setting.key, currentValue === 'true' ? 'false' : 'true')}
                        className={`w-10 h-5 rounded-full relative transition-colors ${currentValue === 'true' ? 'bg-primary' : 'bg-muted'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${currentValue === 'true' ? 'left-5' : 'left-0.5'}`} />
                      </button>
                    ) : isNumeric ? (
                      <input type="number" value={currentValue} onChange={e => handleEdit(setting.key, e.target.value)} className="w-24 px-2 py-1 text-sm text-right bg-background border border-border rounded-md focus:border-primary focus:outline-none font-mono" />
                    ) : (
                      <input type="text" value={currentValue} onChange={e => handleEdit(setting.key, e.target.value)} className="w-48 px-2 py-1 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none" />
                    )}
                    {!setting.is_default && (
                      <button onClick={() => handleReset(setting.key)} title="Reset to default" className="text-muted-foreground hover:text-foreground transition-colors p-1">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8a6 6 0 1111.3-2.8" strokeLinecap="round"/><path d="M14 2v3.5h-3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                {setting.updated_by && setting.updated_at && (
                  <div className="text-2xs text-muted-foreground/50 mt-2">
                    Last updated by {setting.updated_by} on {new Date(setting.updated_at * 1000).toLocaleDateString()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Unsaved changes bar */}
      {hasChanges && activeCategory !== 'credentials' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 z-40">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs text-foreground">
            {Object.keys(edits).filter(k => { const s = settings.find(s => s.key === k); return s && edits[k] !== s.value }).length} unsaved change(s)
          </span>
          <button onClick={() => setEdits({})} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Discard</button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

function formatLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
