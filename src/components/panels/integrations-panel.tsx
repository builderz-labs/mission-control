'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Integration, Category } from './integrations-panel-types'
import { IntegrationCard } from './integration-card'
import { IntegrationsPanelHeader } from './integrations-panel-header'
import { UnsavedChangesBar, ConfirmRemoveDialog } from './integrations-panel-footer'

export function IntegrationsPanel() {
  const t = useTranslations('integrations')
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [opAvailable, setOpAvailable] = useState(false)
  const [envPath, setEnvPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('ai')

  // Edits: env var key -> new value
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [pulling, setPulling] = useState<string | null>(null)
  const [pullingAll, setPullingAll] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ integrationId: string; keys: string[] } | null>(null)

  // Auto-dismiss feedback after 3 s; timer is cleaned up on unmount
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current) }, [])

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000)
  }

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations', { signal: AbortSignal.timeout(8000) })
      if (res.status === 401 || res.status === 403) { setError('Admin access required'); return }
      if (!res.ok) { setError('Failed to load integrations'); return }
      const data = await res.json()
      setIntegrations(data.integrations || [])
      setCategories(data.categories || [])
      setOpAvailable(data.opAvailable ?? false)
      setEnvPath(data.envPath ?? null)
      if (data.categories?.[0]) {
        setActiveCategory(prev => {
          // Preserve active tab if it still exists after refresh
          const ids = (data.categories as Category[]).map((c: Category) => c.id)
          return ids.includes(prev) ? prev : ids[0]
        })
      }
    } catch {
      setError('Failed to load integrations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchIntegrations() }, [fetchIntegrations])

  const handleEdit = (envKey: string, value: string) =>
    setEdits(prev => ({ ...prev, [envKey]: value }))

  const cancelEdit = (envKey: string) =>
    setEdits(prev => { const next = { ...prev }; delete next[envKey]; return next })

  const toggleReveal = (envKey: string) =>
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(envKey)) next.delete(envKey); else next.add(envKey)
      return next
    })

  const hasChanges = Object.keys(edits).length > 0

  const handleSave = async () => {
    if (!hasChanges) return
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: edits }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} variable${data.count === 1 ? '' : 's'}`)
        setEdits({})
        setRevealed(new Set())
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => { setEdits({}); setRevealed(new Set()) }

  const handleRemove = async (envKeys: string[]) => {
    try {
      const res = await fetch(`/api/integrations?keys=${encodeURIComponent(envKeys.join(','))}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Removed ${data.count} variable${data.count === 1 ? '' : 's'}`)
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Failed to remove')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const handleTest = async (integrationId: string) => {
    const integrationName = integrations.find(i => i.id === integrationId)?.name ?? integrationId
    setTesting(integrationId)
    showFeedback(true, `Testing ${integrationName}…`)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', integrationId }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, `${integrationName}: ${data.detail ?? 'Connection successful'}`)
      } else {
        showFeedback(false, `${integrationName}: ${data.detail ?? data.error ?? 'Test failed'}`)
      }
    } catch {
      showFeedback(false, `${integrationName}: Network error`)
    } finally {
      setTesting(null)
    }
  }

  const handlePull = async (integrationId: string) => {
    setPulling(integrationId)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', integrationId }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (data.ok) { showFeedback(true, data.detail || 'Pulled from 1Password'); fetchIntegrations() }
      else showFeedback(false, data.error || 'Pull failed')
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPulling(null)
    }
  }

  const handlePullAll = async () => {
    setPullingAll(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull-all', category: activeCategory }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (data.ok) { showFeedback(true, data.detail || 'Pulled from 1Password'); fetchIntegrations() }
      else showFeedback(false, data.error || 'Pull failed')
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPullingAll(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t('loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm flex items-center justify-between gap-4">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => { setError(null); setLoading(true); fetchIntegrations() }}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const filteredIntegrations = integrations.filter(i => i.category === activeCategory)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <IntegrationsPanelHeader
        integrations={integrations}
        categories={categories}
        activeCategory={activeCategory}
        opAvailable={opAvailable}
        envPath={envPath}
        pullingAll={pullingAll}
        hasChanges={hasChanges}
        saving={saving}
        feedback={feedback}
        onSetActiveCategory={setActiveCategory}
        onPullAll={handlePullAll}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />

      <div className="space-y-3">
        {filteredIntegrations.map(integration => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            edits={edits}
            revealed={revealed}
            opAvailable={opAvailable}
            testing={testing === integration.id}
            pulling={pulling === integration.id}
            onEdit={handleEdit}
            onCancelEdit={cancelEdit}
            onToggleReveal={toggleReveal}
            onTest={() => handleTest(integration.id)}
            onPull={() => handlePull(integration.id)}
            onRemove={() => {
              const setKeys = Object.entries(integration.envVars)
                .filter(([, v]) => v.set)
                .map(([k]) => k)
              if (setKeys.length > 0) setConfirmRemove({ integrationId: integration.id, keys: setKeys })
            }}
          />
        ))}
        {filteredIntegrations.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">
            {t('noIntegrationsInCategory')}
          </div>
        )}
      </div>

      {hasChanges && (
        <UnsavedChangesBar
          editCount={Object.keys(edits).length}
          saving={saving}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      )}

      {confirmRemove && (
        <ConfirmRemoveDialog
          integrationId={confirmRemove.integrationId}
          keys={confirmRemove.keys}
          onConfirm={() => { handleRemove(confirmRemove.keys); setConfirmRemove(null) }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}
