'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useMissionControl } from '@/store'
import type { Webhook, Delivery, SchedulerTask, TestResult, WebhookCreateForm } from './webhook-types'
import { CreateWebhookForm } from './webhook-create-form'
import { WebhookListItem } from './webhook-list-item'
import { WebhookAutomations } from './webhook-automations'

// WHY: Panel owns all async state and delegates pure rendering to sub-components,
//      keeping each layer under the 50-line function limit.

function useWebhookData(isLocalMode: boolean) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [automations, setAutomations] = useState<SchedulerTask[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedWebhook, setSelectedWebhook] = useState<number | null>(null)

  const fetchWebhooks = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      const res = await fetch('/api/webhooks', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to fetch webhooks'); return }
      const data = await res.json()
      setWebhooks(data.webhooks || [])
      setError('')
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }, [])

  const fetchDeliveries = useCallback(async (): Promise<void> => {
    if (!selectedWebhook) return
    try {
      const res = await fetch(`/api/webhooks/deliveries?webhook_id=${selectedWebhook}&limit=20`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) { const data = await res.json(); setDeliveries(data.deliveries || []) }
    } catch { /* silent — delivery log is best-effort */ }
  }, [selectedWebhook])

  const fetchAutomations = useCallback(async (): Promise<void> => {
    if (!isLocalMode) { setAutomations([]); return }
    try {
      const res = await fetch('/api/scheduler', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const data = await res.json()
      const tasks: SchedulerTask[] = Array.isArray(data.tasks) ? data.tasks : []
      setAutomations(tasks.filter(t => typeof t.id === 'string' && t.id.includes('webhook')))
    } catch { /* keep UI usable if scheduler is unavailable */ }
  }, [isLocalMode])

  useEffect(() => { void fetchWebhooks() }, [fetchWebhooks])
  useEffect(() => { void fetchDeliveries() }, [fetchDeliveries])
  useEffect(() => { void fetchAutomations() }, [fetchAutomations])
  useSmartPoll(fetchWebhooks, 60000, { pauseWhenDisconnected: true })
  useSmartPoll(fetchAutomations, 60000, { pauseWhenDisconnected: true })

  return { webhooks, automations, deliveries, loading, error, setError, selectedWebhook, setSelectedWebhook, fetchWebhooks, fetchDeliveries, fetchAutomations }
}

function useWebhookActions(
  fetchWebhooks: () => Promise<void>,
  fetchDeliveries: () => Promise<void>,
  fetchAutomations: () => Promise<void>,
  selectedWebhook: number | null,
  setSelectedWebhook: (id: number | null) => void,
) {
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null)

  const handleCreate = async (form: WebhookCreateForm): Promise<void> => {
    try {
      const res = await fetch('/api/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, generate_secret: true }), signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      if (!res.ok) return
      setNewSecret(data.secret)
      await fetchWebhooks()
    } catch { /* surface via parent error state */ }
  }

  const handleToggle = async (id: number, enabled: boolean): Promise<void> => {
    await fetch('/api/webhooks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }), signal: AbortSignal.timeout(8000) })
    await fetchWebhooks()
  }

  const handleDelete = async (id: number): Promise<void> => {
    await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
    if (selectedWebhook === id) setSelectedWebhook(null)
    await fetchWebhooks()
  }

  const handleTest = async (id: number): Promise<void> => {
    setTestingId(id); setTestResult(null)
    try {
      const res = await fetch('/api/webhooks/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      setTestResult(data)
      await fetchWebhooks()
      if (selectedWebhook === id) await fetchDeliveries()
    } catch { setTestResult({ error: 'Network error' }) }
    finally { setTestingId(null) }
  }

  const handleRunAutomation = async (taskId: string): Promise<void> => {
    setRunningAutomationId(taskId)
    try {
      const res = await fetch('/api/scheduler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: taskId }), signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      setTestResult({ success: !!data.ok && res.ok, error: data.error || (!data.ok ? data.message : null), status_code: res.status })
      await fetchAutomations()
    } catch { setTestResult({ success: false, error: 'Failed to run local automation' }) }
    finally { setRunningAutomationId(null) }
  }

  return { testingId, testResult, setTestResult, newSecret, setNewSecret, runningAutomationId, handleCreate, handleToggle, handleDelete, handleTest, handleRunAutomation }
}

export function WebhookPanel(): React.ReactElement {
  const t = useTranslations('webhooks')
  const { dashboardMode } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'
  const [showCreate, setShowCreate] = useState(false)

  const { webhooks, automations, deliveries, loading, error, setError, selectedWebhook, setSelectedWebhook, fetchWebhooks, fetchDeliveries, fetchAutomations } = useWebhookData(isLocalMode)
  const { testingId, testResult, setTestResult, newSecret, setNewSecret, runningAutomationId, handleCreate, handleToggle, handleDelete, handleTest, handleRunAutomation } = useWebhookActions(fetchWebhooks, fetchDeliveries, fetchAutomations, selectedWebhook, setSelectedWebhook)

  const onCreateSubmit = async (form: WebhookCreateForm): Promise<void> => {
    await handleCreate(form)
    setShowCreate(false)
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('configured', { count: webhooks.length })}</p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">{t('addWebhook')}</Button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{error}</div>
      )}

      {newSecret && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-400">{t('secretLabel')}</p>
          <code className="block text-xs font-mono bg-secondary rounded px-2 py-1.5 text-foreground break-all select-all">{newSecret}</code>
          <Button variant="link" size="xs" onClick={() => setNewSecret(null)}>{t('dismiss')}</Button>
        </div>
      )}

      {testResult && (
        <div className={`rounded-lg border p-3 space-y-1 ${testResult.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              {testResult.success ? <span className="text-green-400">{t('testSuccessful')}</span> : <span className="text-red-400">{t('testFailed')}</span>}
            </p>
            <Button variant="link" size="xs" onClick={() => setTestResult(null)}>{t('dismiss')}</Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {testResult.status_code && <p>{t('testStatus')} <span className="font-mono">{testResult.status_code}</span></p>}
            {testResult.duration_ms && <p>{t('testDuration')} <span className="font-mono">{testResult.duration_ms}ms</span></p>}
            {testResult.error && <p className="text-red-400">{t('testError')} {testResult.error}</p>}
          </div>
        </div>
      )}

      {showCreate && <CreateWebhookForm onSubmit={onCreateSubmit} onCancel={() => setShowCreate(false)} />}

      <div className="space-y-2">
        {isLocalMode && <WebhookAutomations tasks={automations} runningAutomationId={runningAutomationId} onRun={handleRunAutomation} />}

        {loading && webhooks.length === 0 ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg shimmer" />)}</div>
        ) : webhooks.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-xs text-muted-foreground">{t('noWebhooks')}</p>
            <p className="text-2xs text-muted-foreground/60 mt-1">{t('noWebhooksDesc')}</p>
          </div>
        ) : (
          webhooks.map((wh) => (
            <WebhookListItem
              key={wh.id}
              webhook={wh}
              isSelected={selectedWebhook === wh.id}
              deliveries={selectedWebhook === wh.id ? deliveries : []}
              testingId={testingId}
              onSelect={(id) => setSelectedWebhook(selectedWebhook === id ? null : id)}
              onTest={handleTest}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}
