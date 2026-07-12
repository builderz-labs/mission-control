'use client'

// Home ADHD-friendly del fork (HLX-299): "cabina apagada — solo brillan las puertas".
// Un launcher centrado de tiles-app grandes, UN número vivo por tile, y el único
// pulso permitido (ámbar te-necesita) cuando algo espera a Musa. Cero charts aquí:
// una decisión por pantalla; el Dashboard denso vive en el tile Cockpit.

import { useCallback, useState, type ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface TileStat {
  value: number | null
  needsYou: boolean
}

interface Tile {
  id: string
  label: string
  sub: string
  icon: ReactElement
  statKey: keyof HomeStats
}

interface HomeStats {
  tasks: TileStat
  artifacts: TileStat
  agents: TileStat
  crons: TileStat
  github: TileStat
  quests: TileStat
  chat: TileStat
  cockpit: TileStat
}

const EMPTY: HomeStats = {
  tasks: { value: null, needsYou: false },
  artifacts: { value: null, needsYou: false },
  agents: { value: null, needsYou: false },
  crons: { value: null, needsYou: false },
  github: { value: null, needsYou: false },
  quests: { value: null, needsYou: false },
  chat: { value: null, needsYou: false },
  cockpit: { value: null, needsYou: false },
}

// Iconos inline (stroke currentColor) — mismos trazos 1.5px del nav-rail.
function I({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8" aria-hidden>
      <path d={d} />
    </svg>
  )
}

const TILES: Tile[] = [
  { id: 'tasks', label: 'TASKS', sub: 'pendientes', statKey: 'tasks',
    icon: <I d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /> },
  { id: 'artifacts', label: 'ARTIFACTS', sub: 'entregables', statKey: 'artifacts',
    icon: <I d="M4 4h16v16H4zM4 9h16M9 9v11" /> },
  { id: 'agents', label: 'AGENTES', sub: 'en el roster', statKey: 'agents',
    icon: <I d="M12 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 13a7 7 0 0 1 14 0M12 8v4" /> },
  { id: 'cron', label: 'CRONS', sub: 'programados', statKey: 'crons',
    icon: <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2" /> },
  { id: 'github', label: 'GITHUB', sub: 'PRs abiertos', statKey: 'github',
    icon: <I d="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm12 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9v3a6 6 0 0 0 6 6h3" /> },
  { id: 'quests', label: 'QUESTS', sub: 'del día', statKey: 'quests',
    icon: <I d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z" /> },
  { id: 'chat', label: 'CHAT', sub: 'con Helix', statKey: 'chat',
    icon: <I d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /> },
  { id: 'dashboard', label: 'TABLERO', sub: 'vista densa', statKey: 'cockpit',
    icon: <I d="M3 12h4l2-7 4 14 2-7h6" /> },
]

async function safeJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export function HomeLauncher() {
  const router = useRouter()
  const [stats, setStats] = useState<HomeStats>(EMPTY)

  const fetchStats = useCallback(async () => {
    const [tasks, artifacts, agents, cron, github] = await Promise.all([
      safeJson('/api/tasks'),
      safeJson('/api/artifacts'),
      safeJson('/api/agents'),
      safeJson('/api/cron?action=list'),
      safeJson('/api/github?action=prs'),
    ])
    const taskList: any[] = tasks?.tasks ?? (Array.isArray(tasks) ? tasks : [])
    const assigned = taskList.filter(t => ['assigned', 'inbox', 'review'].includes(t.status))
    const agentList: any[] = agents?.agents ?? (Array.isArray(agents) ? agents : [])
    const cronJobs: any[] = cron?.jobs ?? []
    setStats({
      tasks: { value: taskList.length ? assigned.length : taskList.length, needsYou: assigned.length > 0 },
      artifacts: { value: artifacts?.total ?? null, needsYou: false },
      agents: { value: agentList.length || null, needsYou: false },
      crons: { value: cronJobs.filter(j => j.enabled !== false).length || null, needsYou: false },
      github: { value: github?.openCount ?? null, needsYou: false },
      quests: { value: null, needsYou: false },
      chat: { value: null, needsYou: false },
      cockpit: { value: null, needsYou: false },
    })
  }, [])

  useSmartPoll(fetchStats, 60000)

  const needsYouCount = Object.values(stats).filter(s => s.needsYou).length

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-6 py-10">
      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-2">
        Helix Mission Control
      </p>
      <h1 className="text-lg text-primary mb-1">¿Dónde quieres estar?</h1>
      <p className="text-sm text-muted-foreground mb-10 font-sans">
        {needsYouCount > 0
          ? `${needsYouCount} ${needsYouCount === 1 ? 'área te necesita' : 'áreas te necesitan'}`
          : 'nada urgente — todo corre solo'}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl" role="navigation" aria-label="Secciones">
        {TILES.map(tile => {
          const s = stats[tile.statKey]
          return (
            <button
              key={tile.id}
              onClick={() => router.push(`/${tile.id}`)}
              className="group relative flex flex-col items-center gap-2 rounded-xl border border-border
                bg-card px-4 py-6 transition-colors duration-150 hover:border-primary/60
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.needsYou && (
                <span
                  aria-label="te necesita"
                  className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-warning motion-safe:animate-pulse"
                />
              )}
              <span className="text-muted-foreground group-hover:text-primary transition-colors duration-150">
                {tile.icon}
              </span>
              <span className="text-xs tracking-[0.18em]">{tile.label}</span>
              <span className="text-[11px] text-muted-foreground leading-none">
                {s.value !== null ? (
                  <><span className="text-foreground tabular-nums">{s.value}</span> {tile.sub}</>
                ) : (
                  tile.sub
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
