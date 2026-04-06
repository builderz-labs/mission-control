'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { Loader } from '@/components/ui/loader'
import {
  type Setting,
  type ApiKeyInfo,
  type CoordinatorTargetAgent,
  type CoordinatorSession,
  categoryLabels,
  categoryOrder,
  parseCoordinatorTargetAgents,
} from './settings/settings-types'
import { SecuritySettings } from './settings/SecuritySettings'
import { ProfilesSettings } from './settings/ProfilesSettings'
import { GeneralSettings } from './settings/GeneralSettings'
import { StationSetup } from './settings/StationSetup'
import { SettingsList } from './settings/SettingsList'
import { AccountSettings } from './settings/AccountSettings'

export function SettingsPanel() {
  const { currentUser } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [settings, setSettings] = useState<Setting[]>([])
  const [grouped, setGrouped] = useState<Record<string, Setting[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [activeCategory, setActiveCategory] = useState('general')

  // API key management state
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null)
  const [apiKeyLoading, setApiKeyLoading] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [rotateConfirm, setRotateConfirm] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  // Hook profile state
  const [hookProfile, setHookProfile] = useState<string>('standard')
  const [hookProfileSaving, setHookProfileSaving] = useState(false)
  const [coordinatorTargetAgents, setCoordinatorTargetAgents] = useState<CoordinatorTargetAgent[]>([])
  const [coordinatorSessions, setCoordinatorSessions] = useState<CoordinatorSession[]>([])

  // Hermes integration state
  const [hermesStatus, setHermesStatus] = useState<{
    installed: boolean; gatewayRunning: boolean; hookInstalled: boolean
    activeSessions: number; cronJobCount?: number; memoryEntries?: number
  } | null>(null)

  // Ref tracks auto-dismiss timers to cancel on unmount
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keyCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    if (keyCopiedTimerRef.current) clearTimeout(keyCopiedTimerRef.current)
  }, [])

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000)
  }

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings', { signal: AbortSignal.timeout(8000) })
      if (res.status === 401) { window.location.assign('/login?next=%2Fsettings'); return }
      if (res.status === 403) { setError('Admin access required'); return }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to load settings')
        return
      }
      const data = await res.json()
      setSettings(data.settings || [])
      setGrouped(data.grouped || {})
      const hpSetting = (data.settings || []).find((s: Setting) => s.key === 'hook_profile')
      if (hpSetting) setHookProfile(hpSetting.value)

      // Load agent options and sessions for coordinator routing (non-critical)
      try {
        const agentsRes = await fetch('/api/agents?limit=200', { signal: AbortSignal.timeout(8000) })
        if (agentsRes.ok) {
          const agentsData = await agentsRes.json()
          setCoordinatorTargetAgents(parseCoordinatorTargetAgents(agentsData.agents || []))
        }
      } catch { /* non-critical */ }

      try {
        const sessionsRes = await fetch('/api/sessions', { signal: AbortSignal.timeout(8000) })
        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json()
          const mapped: CoordinatorSession[] = Array.isArray(sessionsData.sessions)
            ? sessionsData.sessions.map((session: Record<string, unknown>) => ({
                key: String(session?.key || ''),
                agent: String(session?.agent || ''),
                source: typeof session?.source === 'string' ? session.source : undefined,
                sessionId: String(session?.id || session?.key || ''),
                updatedAt: Number(session?.lastActivity || session?.startTime || 0),
                chatType: String(session?.kind || 'unknown'),
                channel: String(session?.channel || ''),
                model: String(session?.model || ''),
                totalTokens: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0,
                active: Boolean(session?.active),
              })).filter((s: CoordinatorSession) => s.key && s.agent)
            : []
          setCoordinatorSessions(mapped)
        }
      } catch { /* non-critical */ }
    } catch {
      setError('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchApiKeyInfo = useCallback(async () => {
    setApiKeyLoading(true)
    try {
      const res = await fetch('/api/tokens/rotate', { signal: AbortSignal.timeout(8000) })
      if (res.ok) setApiKeyInfo(await res.json())
    } catch { /* non-critical */ }
    finally { setApiKeyLoading(false) }
  }, [])

  const fetchHermesStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes', { signal: AbortSignal.timeout(8000) })
      if (res.ok) setHermesStatus(await res.json())
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { fetchSettings(); fetchApiKeyInfo(); fetchHermesStatus() }, [fetchSettings, fetchApiKeyInfo, fetchHermesStatus])

  const handleRotateKey = async () => {
    setRotating(true)
    try {
      const res = await fetch('/api/tokens/rotate', { method: 'POST', signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      if (res.ok) {
        setNewApiKey(data.key)
        setRotateConfirm(false)
        setKeyCopied(false)
        showFeedback(true, 'API key rotated successfully')
        fetchApiKeyInfo()
      } else {
        showFeedback(false, data.error || 'Failed to rotate key')
      }
    } catch { showFeedback(false, 'Network error') }
    finally { setRotating(false) }
  }

  const handleCopyKey = async () => {
    if (!newApiKey) return
    try {
      await navigator.clipboard.writeText(newApiKey)
    } catch {
      // Fallback: select and copy
      const el = document.createElement('textarea')
      el.value = newApiKey
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setKeyCopied(true)
    if (keyCopiedTimerRef.current) clearTimeout(keyCopiedTimerRef.current)
    keyCopiedTimerRef.current = setTimeout(() => setKeyCopied(false), 2000)
  }

  const handleHookProfileSelect = async (value: 'minimal' | 'standard' | 'strict') => {
    setHookProfile(value)
    setHookProfileSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'hook_profile', value }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        showFeedback(true, `Hook profile set to ${value}`)
      } else {
        showFeedback(false, 'Failed to save hook profile')
      }
    } catch { showFeedback(false, 'Network error') }
    finally { setHookProfileSaving(false) }
  }

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

    // Warn before persisting any retention-related changes — they may permanently delete data
    const hasRetentionChange = Object.keys(changes).some(k => k.includes('retention'))
    if (hasRetentionChange && !window.confirm('Changing retention settings may permanently delete data. Continue?')) {
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: changes }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} setting${data.count === 1 ? '' : 's'}`)
        setEdits({})
        fetchSettings()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch { showFeedback(false, 'Network error') }
    finally { setSaving(false) }
  }

  const handleReset = async (key: string) => {
    try {
      const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Reset "${key}" to default`)
        setEdits(prev => { const next = { ...prev }; delete next[key]; return next })
        fetchSettings()
      } else {
        showFeedback(false, data.error || 'Failed to reset')
      }
    } catch { showFeedback(false, 'Network error') }
  }

  if (loading) return <Loader variant="panel" label="Loading settings" />
  if (error) return <div className="p-6"><div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div></div>

  const categories = categoryOrder.filter(c => c === 'security' || c === 'profiles' || (grouped[c]?.length > 0))

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Configure Ultron behavior and retention policies</p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && <Button onClick={() => setEdits({})} variant="outline" size="sm">Discard</Button>}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            variant={hasChanges ? 'default' : 'secondary'}
            size="sm"
            className={!hasChanges ? 'cursor-not-allowed' : ''}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Workspace info (admin only) */}
      {currentUser?.role === 'admin' && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
          <strong className="text-blue-200">Workspace Management:</strong>{' '}
          To create or manage workspaces (tenant instances), go to the{' '}
          <Button onClick={() => navigateToPanel('super-admin')} variant="link" size="xs" className="text-blue-400 hover:text-blue-300 p-0 h-auto">
            Super Admin
          </Button>{' '}
          panel under Admin &gt; Super Admin in the sidebar. From there you can create new client instances, manage tenants, and monitor provisioning jobs.
        </div>
      )}

      {/* Station Setup (admin only) */}
      {currentUser?.role === 'admin' && (
        <StationSetup
          hermesStatus={hermesStatus}
          onFeedback={showFeedback}
          onRefetchHermes={fetchHermesStatus}
        />
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${
          feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-border pb-px">
        {categories.map(cat => {
          const meta = categoryLabels[cat] || { label: cat, icon: '📋', description: '' }
          const changedCount = (grouped[cat] || []).filter(s => edits[s.key] !== undefined && edits[s.key] !== s.value).length
          return (
            <Button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              variant="ghost"
              size="sm"
              className={`rounded-t-md rounded-b-none relative ${
                activeCategory === cat ? 'bg-card text-foreground border border-border border-b-card -mb-px' : ''
              }`}
            >
              {meta.label}
              {changedCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-2xs rounded-full bg-primary text-primary-foreground">
                  {changedCount}
                </span>
              )}
            </Button>
          )
        })}
      </div>

      {/* Per-category content */}
      {activeCategory === 'security' && (
        <SecuritySettings
          apiKeyInfo={apiKeyInfo}
          apiKeyLoading={apiKeyLoading}
          newApiKey={newApiKey}
          rotateConfirm={rotateConfirm}
          rotating={rotating}
          keyCopied={keyCopied}
          onSetRotateConfirm={setRotateConfirm}
          onRotateKey={handleRotateKey}
          onCopyKey={handleCopyKey}
          onDismissNewKey={() => setNewApiKey(null)}
        />
      )}
      {activeCategory === 'profiles' && (
        <ProfilesSettings
          hookProfile={hookProfile}
          hookProfileSaving={hookProfileSaving}
          onSelectProfile={handleHookProfileSelect}
        />
      )}
      {activeCategory === 'general' && <GeneralSettings />}

      {/* Generic settings list (all categories except security which has custom UI) */}
      {activeCategory !== 'security' && (
        <SettingsList
          settings={settings}
          activeCategory={activeCategory}
          edits={edits}
          coordinatorTargetAgents={coordinatorTargetAgents}
          coordinatorSessions={coordinatorSessions}
          onEdit={handleEdit}
          onReset={handleReset}
        />
      )}

      {/* Account / OAuth */}
      <AccountSettings />
      {/* Unsaved changes bar */}
      {hasChanges && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 z-40">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs text-foreground">
            {Object.keys(edits).filter(k => { const s = settings.find(s => s.key === k); return s && edits[k] !== s.value }).length} unsaved change(s)
          </span>
          <Button onClick={() => setEdits({})} variant="ghost" size="xs">Discard</Button>
          <Button onClick={handleSave} disabled={saving} size="xs">{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      )}
    </div>
  )
}
