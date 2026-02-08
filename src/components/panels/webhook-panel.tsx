'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface Webhook {
  id: number
  name: string
  url: string
  secret: string | null
  events: string[]
  enabled: boolean
  last_fired_at: number | null
  last_status: number | null
  total_deliveries: number
  successful_deliveries: number
  failed_deliveries: number
  created_at: number
  updated_at: number
}

interface Delivery {
  id: number
  webhook_id: number
  webhook_name: string
  webhook_url: string
  event_type: string
  payload: string
  status_code: number | null
  response_body: string | null
  error: string | null
  duration_ms: number
  created_at: number
}

const AVAILABLE_EVENTS = [
  { value: '*', label: 'All events', description: 'Receive all event types' },
  { value: 'agent.error', label: 'Agent error', description: 'Agent enters error state' },
  { value: 'agent.status_change', label: 'Agent status change', description: 'Any agent status transition' },
  { value: 'security.login_failed', label: 'Login failed', description: 'Failed login attempt' },
  { value: 'security.user_created', label: 'User created', description: 'New user account created' },
  { value: 'security.user_deleted', label: 'User deleted', description: 'User account deleted' },
  { value: 'security.password_change', label: 'Password changed', description: 'User password modified' },
  { value: 'notification.mention', label: 'Mention', description: 'Agent was @mentioned' },
  { value: 'notification.assignment', label: 'Assignment', description: 'Task assigned to agent' },
  { value: 'activity.task_created', label: 'Task created', description: 'New task added' },
  { value: 'activity.task_updated', label: 'Task updated', description: 'Task status changed' },
]

export function WebhookPanel() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedWebhook, setSelectedWebhook] = useState<number | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<any>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  const fetchWebhooks = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/webhooks')
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to fetch webhooks')
        return
      }
      const data = await res.json()
      setWebhooks(data.webhooks || [])
      setError('')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDeliveries = useCallback(async () => {
    if (!selectedWebhook) return
    try {
      const res = await fetch(`/api/webhooks/deliveries?webhook_id=${selectedWebhook}&limit=20`)
      if (res.ok) {
        const data = await res.json()
        setDeliveries(data.deliveries || [])
      }
    } catch { /* silent */ }
  }, [selectedWebhook])

  useEffect(() => { fetchWebhooks() }, [fetchWebhooks])
  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])
  useSmartPoll(fetchWebhooks, 60000, { pauseWhenDisconnected: true })

  async function handleCreate(form: { name: string; url: string; events: string[] }) {
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, generate_secret: true }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setNewSecret(data.secret)
      setShowCreate(false)
      fetchWebhooks()
    } catch { setError('Failed to create webhook') }
  }

  async function handleToggle(id: number, enabled: boolean) {
    await fetch('/api/webhooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    })
    fetchWebhooks()
  }

  async function handleDelete(id: number) {
    await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE' })
    if (selectedWebhook === id) setSelectedWebhook(null)
    fetchWebhooks()
  }

  async function handleTest(id: number) {
    setTestingId(id)
    setTestResult(null)
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      setTestResult(data)
      fetchWebhooks()
      if (selectedWebhook === id) fetchDeliveries()
    } catch {
      setTestResult({ error: 'Network error' })
    } finally {
      setTestingId(null)
    }
  }

  function formatTime(ts: number) {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Webhooks</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth"
        >
          + Add Webhook
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Secret reveal (after creation) */}
      {newSecret && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-400">Webhook Secret (save now - shown only once)</p>
          <code className="block text-xs font-mono bg-secondary rounded px-2 py-1.5 text-foreground break-all select-all">
            {newSecret}
          </code>
          <button
            onClick={() => setNewSecret(null)}
            className="text-xs text-muted-foreground hover:text-foreground transition-smooth"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div className={`rounded-lg border p-3 space-y-1 ${
          testResult.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              {testResult.success ? (
                <span className="text-green-400">Test successful</span>
              ) : (
                <span className="text-red-400">Test failed</span>
              )}
            </p>
            <button onClick={() => setTestResult(null)} className="text-xs text-muted-foreground">
              Dismiss
            </button>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {testResult.status_code && <p>Status: <span className="font-mono">{testResult.status_code}</span></p>}
            {testResult.duration_ms && <p>Duration: <span className="font-mono">{testResult.duration_ms}ms</span></p>}
            {testResult.error && <p className="text-red-400">Error: {testResult.error}</p>}
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <CreateWebhookForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Webhook list */}
      <div className="space-y-2">
        {loading && webhooks.length === 0 ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg shimmer" />)}
          </div>
        ) : webhooks.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-xs text-muted-foreground">No webhooks configured</p>
            <p className="text-2xs text-muted-foreground/60 mt-1">
              Add a webhook to receive HTTP notifications for events
            </p>
          </div>
        ) : (
          webhooks.map((wh) => (
            <div
              key={wh.id}
              className={`rounded-lg border p-3 transition-smooth ${
                selectedWebhook === wh.id ? 'border-primary/40 bg-primary/5' : 'border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => setSelectedWebhook(selectedWebhook === wh.id ? null : wh.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${wh.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                    <span className="text-sm font-medium text-foreground">{wh.name}</span>
                    {wh.last_status !== null && (
                      <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${
                        wh.last_status >= 200 && wh.last_status < 300
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}>
                        {wh.last_status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{wh.url}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-2xs text-muted-foreground">
                    <span>{wh.events.includes('*') ? 'All events' : `${wh.events.length} event${wh.events.length !== 1 ? 's' : ''}`}</span>
                    <span>{wh.total_deliveries} deliveries</span>
                    {wh.failed_deliveries > 0 && (
                      <span className="text-red-400">{wh.failed_deliveries} failed</span>
                    )}
                    {wh.last_fired_at && (
                      <span>Last fired {formatTime(wh.last_fired_at)}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleTest(wh.id)}
                    disabled={testingId === wh.id}
                    className="h-7 px-2 text-2xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-smooth disabled:opacity-50"
                    title="Send test event"
                  >
                    {testingId === wh.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleToggle(wh.id, !wh.enabled)}
                    className={`h-7 px-2 text-2xs font-medium rounded transition-smooth ${
                      wh.enabled
                        ? 'text-amber-400 hover:bg-amber-500/10'
                        : 'text-green-400 hover:bg-green-500/10'
                    }`}
                  >
                    {wh.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleDelete(wh.id)}
                    className="h-7 px-2 text-2xs font-medium text-red-400 hover:bg-red-500/10 rounded transition-smooth"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Delivery log (expanded) */}
              {selectedWebhook === wh.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <h4 className="text-xs font-semibold text-foreground">Recent Deliveries</h4>
                  {deliveries.length === 0 ? (
                    <p className="text-2xs text-muted-foreground">No deliveries recorded yet</p>
                  ) : (
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {deliveries.map((d) => (
                        <div key={d.id} className="flex items-center gap-2 text-2xs py-1 px-2 rounded hover:bg-secondary/50">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            d.status_code && d.status_code >= 200 && d.status_code < 300
                              ? 'bg-green-500'
                              : 'bg-red-500'
                          }`} />
                          <span className="font-mono text-muted-foreground w-16 shrink-0">
                            {d.event_type}
                          </span>
                          <span className={`font-mono w-8 shrink-0 ${
                            d.status_code && d.status_code >= 200 && d.status_code < 300
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}>
                            {d.status_code ?? 'ERR'}
                          </span>
                          <span className="text-muted-foreground font-mono">
                            {d.duration_ms}ms
                          </span>
                          {d.error && (
                            <span className="text-red-400 truncate">{d.error}</span>
                          )}
                          <span className="text-muted-foreground/50 ml-auto shrink-0">
                            {formatTime(d.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CreateWebhookForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (form: { name: string; url: string; events: string[] }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['*'])

  function toggleEvent(value: string) {
    if (value === '*') {
      setSelectedEvents(['*'])
      return
    }
    setSelectedEvents((prev) => {
      const without = prev.filter((e) => e !== '*' && e !== value)
      if (prev.includes(value)) return without.length === 0 ? ['*'] : without
      return [...without, value]
    })
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">New Webhook</h3>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Slack alerts"
          className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1.5">Events</label>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABLE_EVENTS.map((ev) => (
            <button
              key={ev.value}
              type="button"
              onClick={() => toggleEvent(ev.value)}
              title={ev.description}
              className={`h-6 px-2 rounded text-2xs font-medium transition-smooth ${
                selectedEvents.includes(ev.value)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {ev.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 h-8 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-smooth"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ name, url, events: selectedEvents })}
          disabled={!name || !url}
          className="flex-1 h-8 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth disabled:opacity-50"
        >
          Create Webhook
        </button>
      </div>
    </div>
  )
}
