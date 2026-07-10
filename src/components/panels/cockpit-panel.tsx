'use client'

// Panel "Cockpit" (HLX-265): metas de Musa por horizontes (HOY / ESTE MES / HORIZONTE)
// desde el JSON que escribe goals-collector.sh cada 30 min. Solo lectura, UI en español.

import { useCallback, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface Issue {
  identifier: string
  title: string
  priority: number
  url: string
  project: string | null
  state: string
  updatedAt: number
}

interface Alerta {
  tipo: 'urgente' | 'estancada'
  texto: string
  url: string
}

interface Iniciativa {
  name: string
  projectCount: number
  projects: { name: string; state: string }[]
  lastActivity: number | null
  semaforo: 'verde' | 'amarillo' | 'rojo'
}

interface Goals {
  collectedAt: number
  hoy: { urgentes: Issue[]; altas: Issue[]; enCurso: Issue[]; alertas: Alerta[] }
  mes: Iniciativa[]
  largo: {
    iniciativas: { name: string; projects: string[] }[]
    proyectos: { name: string; iniciativa: string }[]
  }
  conteos: Record<string, number>
}

function timeAgo(epochSec: number | null): string {
  if (!epochSec) return 'sin actividad'
  const mins = Math.floor((Date.now() / 1000 - epochSec) / 60)
  if (mins < 1) return 'hace <1 min'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} días`
}

const SEMAFORO = { verde: '🟢', amarillo: '🟡', rojo: '🔴' } as const

function IssueCard({ issue, tone }: { issue: Issue; tone: 'urgent' | 'progress' | 'high' }) {
  const border =
    tone === 'urgent' ? 'border-red-500/40 hover:border-red-500'
    : tone === 'progress' ? 'border-void-cyan/40 hover:border-void-cyan'
    : 'border-border hover:border-primary/50'
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-lg border bg-card p-3 transition-colors ${border}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-xs text-muted-foreground">{issue.identifier}</span>
        <span className="text-xs text-muted-foreground/70">{issue.state}</span>
        <span className="ml-auto text-xs text-muted-foreground/70 whitespace-nowrap">{timeAgo(issue.updatedAt)}</span>
      </div>
      <p className="text-sm leading-snug line-clamp-2">{issue.title}</p>
      {issue.project && <p className="text-xs text-muted-foreground mt-1 truncate">{issue.project}</p>}
    </a>
  )
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">{label}</h3>
      {hint && <span className="text-xs text-muted-foreground/60">{hint}</span>}
    </div>
  )
}

export function CockpitPanel() {
  const [data, setData] = useState<Goals | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/goals-inventory')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar las metas')
    }
  }, [])

  useSmartPoll(fetchData, 60000)

  if (error) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-2">Cockpit</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando metas…</div>
  }

  const staleness = Date.now() / 1000 - data.collectedAt
  const abiertas = (data.conteos['Backlog'] || 0) + (data.conteos['Todo'] || 0) + (data.conteos['In Progress'] || 0)

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Cockpit</h2>
          <p className="text-xs text-muted-foreground">
            Actualizado {timeAgo(data.collectedAt)}
            {staleness > 60 * 60 && ' — ⚠ colector atrasado (esperado cada 30 min)'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{abiertas} issues abiertas</span>
          <span>{data.conteos['In Progress'] || 0} en curso</span>
          <span>{data.conteos['Done'] || 0} done</span>
        </div>
      </div>

      {/* ── HOY ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader label="HOY" hint="urgente + en curso" />

        {data.hoy.alertas.length > 0 && (
          <div className="space-y-1.5">
            {data.hoy.alertas.map(a => (
              <a
                key={a.texto}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`block rounded-md px-3 py-2 text-xs border ${
                  a.tipo === 'urgente'
                    ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15'
                    : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/15'
                }`}
              >
                {a.tipo === 'urgente' ? '⚠ ' : '⏸ '}{a.texto}
              </a>
            ))}
          </div>
        )}

        {data.hoy.urgentes.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.hoy.urgentes.map(i => <IssueCard key={i.identifier} issue={i} tone="urgent" />)}
          </div>
        )}

        <p className="text-xs text-muted-foreground">En curso ({data.hoy.enCurso.length})</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.hoy.enCurso.map(i => <IssueCard key={i.identifier} issue={i} tone="progress" />)}
          {data.hoy.enCurso.length === 0 && (
            <p className="text-sm text-muted-foreground">Nada en curso ahora mismo.</p>
          )}
        </div>
      </section>

      {/* ── ESTE MES ────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader label="ESTE MES" hint="iniciativas activas" />
        <div className="rounded-lg border border-border bg-card divide-y divide-border/50">
          {data.mes.map(ini => (
            <div key={ini.name} className="flex items-center gap-3 px-4 py-3">
              <span className="text-base leading-none" title={`semáforo: ${ini.semaforo}`}>
                {SEMAFORO[ini.semaforo]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{ini.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {ini.projects.map(p => p.name).join(' · ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">
                  {ini.projectCount} {ini.projectCount === 1 ? 'proyecto' : 'proyectos'}
                </p>
                <p className="text-xs text-muted-foreground/70">{timeAgo(ini.lastActivity)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HORIZONTE ───────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader label="HORIZONTE" hint="planeado, sin arrancar" />
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          {data.largo.iniciativas.map(ini => (
            <div key={ini.name} className="flex items-baseline gap-2 text-sm">
              <span className="font-medium">{ini.name}</span>
              <span className="text-xs text-muted-foreground truncate">
                {ini.projects.length > 0 ? ini.projects.join(' · ') : 'sin proyectos aún'}
              </span>
            </div>
          ))}
          {data.largo.proyectos.map(p => (
            <div key={`${p.iniciativa}/${p.name}`} className="flex items-baseline gap-2 text-sm">
              <span className="text-muted-foreground">{p.name}</span>
              <span className="text-xs text-muted-foreground/60">({p.iniciativa})</span>
            </div>
          ))}
          {data.largo.iniciativas.length === 0 && data.largo.proyectos.length === 0 && (
            <p className="text-sm text-muted-foreground">Horizonte despejado.</p>
          )}
        </div>
      </section>
    </div>
  )
}
