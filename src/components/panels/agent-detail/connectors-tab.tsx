'use client'

import { useCallback, useEffect, useState } from 'react'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { apiFetch } from '@/lib/api-client'

interface Inventory {
  agent: string
  runtime: string
  connectors: Array<{ name: string; cli: string; transport?: string; source: string }>
  plugins: string[]
  automations: string[]
}

export function ConnectorsTab({ agent }: { agent: { id: number; name: string } }) {
  const [data, setData] = useState<Inventory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await apiFetch<Inventory>(`/api/agents/${agent.id}/inventory`)
      setData(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connectors')
    } finally {
      setLoading(false)
    }
  }, [agent.id])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return (
      <div className="p-6 flex justify-center">
        <Loader variant="inline" label="Loading connectors" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AgentAvatar name={agent.name} size="sm" />
          <div>
            <h4 className="text-lg font-medium text-foreground">Connectors</h4>
            <p className="text-xs text-muted-foreground">MCP, plugins, and automations for {agent.name}. Names only.</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={load} disabled={loading}>Refresh</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <section className="rounded-lg border border-border">
        <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">MCP / extensions</div>
        {(data?.connectors || []).length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">No connectors indexed.</div>
        ) : (
          <ul className="divide-y divide-border">
            {data?.connectors.map((item) => (
              <li key={`${item.cli}:${item.name}`} className="px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{item.name}</span>
                <span className="text-2xs text-muted-foreground">{item.cli} · {item.transport}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground mb-2">Plugins</div>
          <p className="text-sm text-foreground">{data?.plugins.join(', ') || 'none'}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground mb-2">Automations</div>
          <p className="text-sm text-foreground">{data?.automations.join(', ') || 'none'}</p>
        </div>
      </section>
    </div>
  )
}
