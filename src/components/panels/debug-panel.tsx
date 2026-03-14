'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

type Tab = 'status' | 'health' | 'models' | 'apicall'

export function DebugPanel() {
  const t = useTranslations('debug')
  const [activeTab, setActiveTab] = useState<Tab>('status')

  const tabLabels: Record<Tab, string> = {
    status: t('tabStatus'),
    health: t('tabHealth'),
    models: t('tabModels'),
    apicall: t('tabApiCall'),
  }

  return (
    <div className="m-4">
      <div className="flex gap-1 mb-4 border-b border-border pb-2">
        {(['status', 'health', 'models', 'apicall'] as const).map((tab) => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab(tab)}
          >
            {tabLabels[tab]}
          </Button>
        ))}
      </div>

      {activeTab === 'status' && <StatusTab />}
      {activeTab === 'health' && <HealthTab />}
      {activeTab === 'models' && <ModelsTab />}
      {activeTab === 'apicall' && <ApiCallTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status Tab
// ---------------------------------------------------------------------------

function StatusTab() {
  const t = useTranslations('debug')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/debug?action=status')
      setData(await res.json())
    } catch {
      setData({ error: 'Failed to fetch status' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const reachable = data && !data.gatewayReachable === false && data.gatewayReachable !== false

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm text-muted-foreground">{t('gateway')}:</span>
        {loading ? (
          <span className="text-xs text-muted-foreground">{t('checking')}</span>
        ) : (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              reachable
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {reachable ? t('reachable') : t('unreachable')}
          </span>
        )}
        <Button variant="ghost" size="xs" onClick={fetchStatus} disabled={loading}>
          {t('refresh')}
        </Button>
      </div>
      <pre className="bg-secondary rounded-lg p-4 text-xs font-mono overflow-auto max-h-96 text-foreground">
        {loading ? t('loading') : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Health Tab
// ---------------------------------------------------------------------------

function HealthTab() {
  const t = useTranslations('debug')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [heartbeat, setHeartbeat] = useState<{ ok: boolean; latencyMs: number; timestamp: number } | null>(null)
  const [hbLoading, setHbLoading] = useState(false)

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/debug?action=health')
      setData(await res.json())
    } catch {
      setData({ healthy: false, error: 'Failed to fetch' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchHealth() }, [fetchHealth])

  const pingHeartbeat = async () => {
    setHbLoading(true)
    try {
      const res = await fetch('/api/debug?action=heartbeat')
      setHeartbeat(await res.json())
    } catch {
      setHeartbeat({ ok: false, latencyMs: -1, timestamp: Date.now() })
    } finally {
      setHbLoading(false)
    }
  }

  const healthy = data?.healthy === true || (data && !data.error && data.healthy !== false)

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm text-muted-foreground">{t('health')}:</span>
        {loading ? (
          <span className="text-xs text-muted-foreground">{t('checking')}</span>
        ) : (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              healthy
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {healthy ? t('healthy') : t('unhealthy')}
          </span>
        )}
        <Button variant="ghost" size="xs" onClick={fetchHealth} disabled={loading}>
          {t('refresh')}
        </Button>
        <Button variant="outline" size="xs" onClick={pingHeartbeat} disabled={hbLoading}>
          {hbLoading ? t('pinging') : t('heartbeat')}
        </Button>
        {heartbeat && (
          <span className="text-xs text-muted-foreground">
            {heartbeat.ok ? t('ok') : t('failed')} - {heartbeat.latencyMs}ms
          </span>
        )}
      </div>

      {data && !loading && (
        <div className="bg-secondary rounded-lg p-4 text-xs overflow-auto max-h-96">
          <table className="w-full text-left">
            <tbody>
              {Object.entries(data).map(([key, value]) => (
                <tr key={key} className="border-b border-border/50 last:border-0">
                  <td className="py-1 pr-4 font-medium text-muted-foreground whitespace-nowrap">{key}</td>
                  <td className="py-1 font-mono text-foreground">
                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Models Tab
// ---------------------------------------------------------------------------

interface ModelEntry {
  name?: string
  id?: string
  provider?: string
  context_length?: number
  [key: string]: any
}

function ModelsTab() {
  const t = useTranslations('debug')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/debug?action=models')
      setData(await res.json())
    } catch {
      setData({ models: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  const models: ModelEntry[] = Array.isArray(data?.models) ? data.models : (Array.isArray(data?.data) ? data.data : [])

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm text-muted-foreground">{t('models')}</span>
        <Button variant="ghost" size="xs" onClick={fetchModels} disabled={loading}>
          {t('refresh')}
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t('loading')}</p>
      ) : models.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noModels')}</p>
      ) : (
        <div className="bg-secondary rounded-lg overflow-auto max-h-96">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 px-3 font-medium text-muted-foreground">{t('colName')}</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">{t('colProvider')}</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">{t('colContextLength')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m, i) => (
                <tr key={m.id || m.name || i} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 px-3 font-mono text-foreground">{m.name || m.id || '?'}</td>
                  <td className="py-1.5 px-3 text-muted-foreground">{m.provider || '-'}</td>
                  <td className="py-1.5 px-3 text-muted-foreground">{m.context_length ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// API Call Tab
// ---------------------------------------------------------------------------

function ApiCallTab() {
  const t = useTranslations('debug')
  const [method, setMethod] = useState<'GET' | 'POST'>('GET')
  const [path, setPath] = useState('/api/')
  const [body, setBody] = useState('')
  const [response, setResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const send = async () => {
    setLoading(true)
    setResponse(null)
    try {
      let parsedBody: any = undefined
      if (method === 'POST' && body.trim()) {
        try {
          parsedBody = JSON.parse(body)
        } catch {
          setResponse({ error: 'Invalid JSON in body' })
          setLoading(false)
          return
        }
      }

      const res = await fetch('/api/debug?action=call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, path, body: parsedBody }),
      })
      setResponse(await res.json())
    } catch {
      setResponse({ error: 'Request failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex items-end gap-2 mb-4">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t('method')}</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
            className="h-8 px-2 rounded border border-border bg-secondary text-foreground text-sm"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-xs text-muted-foreground mb-1">{t('path')}</label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/api/"
            className="h-8 w-full px-2 rounded border border-border bg-secondary text-foreground text-sm font-mono"
          />
        </div>

        <Button variant="default" size="sm" onClick={send} disabled={loading}>
          {loading ? t('sending') : t('send')}
        </Button>
      </div>

      {method === 'POST' && (
        <div className="mb-4">
          <label className="block text-xs text-muted-foreground mb-1">{t('bodyJson')}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder='{"key": "value"}'
            className="w-full px-3 py-2 rounded border border-border bg-secondary text-foreground text-xs font-mono resize-y"
          />
        </div>
      )}

      {response && (
        <div>
          {response.status && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-muted-foreground">{t('statusLabel')}:</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  response.status >= 200 && response.status < 300
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : response.status >= 400
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                }`}
              >
                {response.status} {response.statusText}
              </span>
              {response.contentType && (
                <span className="text-xs text-muted-foreground">{response.contentType}</span>
              )}
            </div>
          )}
          <pre className="bg-secondary rounded-lg p-4 text-xs font-mono overflow-auto max-h-96 text-foreground">
            {typeof response.body !== 'undefined'
              ? (typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2))
              : JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
