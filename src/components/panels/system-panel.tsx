'use client'

// Panel "Sistema" (HLX-234 fase 1): verdad del ecosistema desde el inventario
// que escribe system-collector.sh cada 15 min. Solo lectura, UI en español.

import { useCallback, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface CronEntry {
  label: string
  script: string
  schedule: string
  objetivo: string
  lastRun: number | null
  exitCode: number | null
  pid: number | null
  loaded: boolean
}

interface ServiceEntry {
  name: string
  label: string
  state: 'running' | 'loaded' | 'not-loaded'
  pid: number | null
  exitCode: number | null
}

interface Capability {
  capability: string
  surface: string
  trigger: string
  gate: string
  cost: string
  notes: string
}

interface Catalog {
  updatedAt: number
  total: number
  capabilities: Capability[]
}

interface Inventory {
  collectedAt: number
  crons: CronEntry[]
  services: ServiceEntry[]
  skills: { runtime: string; path: string; count: number }[]
  mcps: string[]
  security: { helixGuardMode: string; sandboxMode: string; execSecurity: string }
  disk: { path: string; kb: number }[]
}

function timeAgo(epochSec: number | null): string {
  if (!epochSec) return '—'
  const mins = Math.floor((Date.now() / 1000 - epochSec) / 60)
  if (mins < 1) return 'hace <1 min'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} días`
}

function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`
  return `${kb} KB`
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'muted'; children: React.ReactNode }) {
  const tones = {
    ok: 'bg-green-500/15 text-green-500',
    warn: 'bg-yellow-500/15 text-yellow-600',
    err: 'bg-red-500/15 text-red-500',
    muted: 'bg-secondary text-muted-foreground',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </div>
  )
}

export function SystemPanel() {
  const [data, setData] = useState<Inventory | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [capFilter, setCapFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/system-inventory')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el inventario')
    }
    // Catálogo aparte: si falla, el resto del panel sigue vivo.
    try {
      const res = await fetch('/api/capabilities')
      if (res.ok) setCatalog(await res.json())
    } catch {
      /* card de capacidades simplemente no se muestra */
    }
  }, [])

  useSmartPoll(fetchData, 60000)

  if (error) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-2">Sistema</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando inventario…</div>
  }

  const staleness = Date.now() / 1000 - data.collectedAt
  const cronsFail = data.crons.filter(c => c.exitCode !== null && c.exitCode !== 0).length

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Sistema</h2>
          <p className="text-xs text-muted-foreground">
            Inventario recolectado {timeAgo(data.collectedAt)}
            {staleness > 30 * 60 && ' — ⚠ colector atrasado (esperado cada 15 min)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={data.security.helixGuardMode === 'enforce' ? 'ok' : 'warn'}>
            guard: {data.security.helixGuardMode}
          </Badge>
          <Badge tone={data.security.sandboxMode === 'all' ? 'ok' : 'warn'}>
            sandbox: {data.security.sandboxMode}
          </Badge>
          <Badge tone={data.security.execSecurity === 'allowlist' ? 'ok' : 'warn'}>
            exec: {data.security.execSecurity}
          </Badge>
        </div>
      </div>

      {/* Servicios */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {data.services.map(svc => (
          <div key={svc.label} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{svc.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{svc.label}</p>
            </div>
            <Badge tone={svc.state === 'running' ? 'ok' : 'err'}>
              {svc.state === 'running' ? `activo · pid ${svc.pid}` : svc.state === 'loaded' ? 'cargado, sin proceso' : 'no cargado'}
            </Badge>
          </div>
        ))}
      </div>

      {/* Crons */}
      <Card title={`Crons (${data.crons.length}${cronsFail ? ` · ${cronsFail} con fallo` : ''})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">Cron</th>
                <th className="py-2 pr-3 font-medium">Horario</th>
                <th className="py-2 pr-3 font-medium">Última corrida</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 font-medium">Objetivo</th>
              </tr>
            </thead>
            <tbody>
              {data.crons.map(cron => (
                <tr key={cron.label} className="border-b border-border/50 last:border-0 align-top">
                  <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                    {cron.label.replace(/^com\.helix\.(cron\.)?/, '')}
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">{cron.schedule}</td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">{timeAgo(cron.lastRun)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {!cron.loaded ? (
                      <Badge tone="err">no cargado</Badge>
                    ) : cron.exitCode === null ? (
                      <Badge tone="muted">sin corridas</Badge>
                    ) : cron.exitCode !== 0 ? (
                      <Badge tone="err">exit {cron.exitCode}</Badge>
                    ) : (
                      <Badge tone="ok">OK</Badge>
                    )}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground max-w-md">{cron.objetivo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Capacidades (CAPABILITIES.md, canon helix-ecosystem) */}
      {catalog && (
        <Card title={`Capacidades (${catalog.total} · catálogo ${timeAgo(catalog.updatedAt)})`}>
          <input
            type="search"
            value={capFilter}
            onChange={e => setCapFilter(e.target.value)}
            placeholder="Filtrar por nombre, trigger, gate, surface…"
            className="w-full mb-3 rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Capacidad</th>
                  <th className="py-2 pr-3 font-medium">Surface</th>
                  <th className="py-2 pr-3 font-medium">Gate</th>
                  <th className="py-2 pr-3 font-medium">Costo</th>
                  <th className="py-2 font-medium">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {catalog.capabilities
                  .filter(c => {
                    const q = capFilter.toLowerCase()
                    return !q || [c.capability, c.surface, c.trigger, c.gate, c.cost].some(f => f.toLowerCase().includes(q))
                  })
                  .map(c => (
                    <tr key={c.capability} className="border-b border-border/50 last:border-0 align-top">
                      <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{c.capability}</td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">{c.surface}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Badge tone={c.gate === 'HARD' ? 'err' : c.gate === 'soft' ? 'warn' : 'muted'}>{c.gate || '—'}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">{c.cost}</td>
                      <td className="py-2 text-xs text-muted-foreground max-w-md">{c.trigger}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card title="Skills por runtime">
          <ul className="space-y-2">
            {data.skills.map(s => (
              <li key={s.runtime} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground" title={s.path}>{s.runtime}</span>
                <span className="font-mono font-medium">{s.count}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`MCPs configurados (${data.mcps.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {data.mcps.map(name => (
              <Badge key={name} tone="muted">{name}</Badge>
            ))}
          </div>
        </Card>

        <Card title="Disco">
          <ul className="space-y-2">
            {data.disk.map(d => (
              <li key={d.path} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-mono text-xs">{d.path}</span>
                <span className="font-medium">{formatKb(d.kb)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
