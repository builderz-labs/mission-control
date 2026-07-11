'use client'

// Panel Quests (HLX-206, New Game): quest board del día + progresión XP.
// Fuente: /api/quests (quest-engine + newgame state). RPG sutil: máx 1 toque
// por vista (regla HLX-217) — la barra de XP es ese toque, no cada quest.

import { useCallback, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface Quest {
  name: string
  why?: string
  ref?: string
  source?: string
  urgency?: string
}

interface Achievement {
  id: string
  name: string
  rule?: string
  unlockedAt?: string
}

interface QuestData {
  generatedAt: string | null
  quests: Quest[]
  closedYesterday: number
  player: { xp: number; level: number; nextLevelAt: number } | null
  questsClosedTotal: number | null
  achievements: Achievement[]
  hiddenLocked: number
}

const LINEAR_BASE = 'https://linear.app/musalab/issue/'

const urgencyTone: Record<string, string> = {
  alta: 'bg-destructive/15 text-destructive border-destructive/30',
  media: 'bg-warning/15 text-warning border-warning/30',
  baja: 'bg-secondary text-muted-foreground border-border',
}

export function QuestsPanel() {
  const [data, setData] = useState<QuestData | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/quests')
      const d = await res.json()
      setNotice(d.error ?? null)
      setData(d.error ? null : d)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar quests')
    }
  }, [])

  useSmartPoll(fetchData, 60000)

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (notice) return <div className="p-6 text-sm text-muted-foreground">{notice}</div>
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Cargando…</div>

  const p = data.player
  const pct = p ? Math.min(100, Math.round((p.xp / p.nextLevelAt) * 100)) : 0

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Quests</h2>
        <p className="text-xs text-muted-foreground">
          {data.quests.length} para hoy
          {data.closedYesterday > 0 && ` · ${data.closedYesterday} cerradas ayer`}
        </p>
      </div>

      {/* Progresión — el único toque RPG de la vista */}
      {p && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold">
              Nivel <span className="font-mono tabular-nums text-primary">{p.level}</span>
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {p.xp} / {p.nextLevelAt} XP
              {data.questsClosedTotal != null && ` · ${data.questsClosedTotal} cerradas`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          {data.achievements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.achievements.map(a => (
                <span
                  key={a.id}
                  title={a.rule ? `${a.rule}${a.unlockedAt ? ` · ${a.unlockedAt}` : ''}` : a.name}
                  className="rounded-full border border-border bg-secondary px-2 py-0.5 text-2xs text-muted-foreground"
                >
                  {a.name}
                </span>
              ))}
              {data.hiddenLocked > 0 && (
                <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-2xs text-muted-foreground/60">
                  +{data.hiddenLocked} oculto
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quest board */}
      {data.quests.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin quests para hoy.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {data.quests.map((q, i) => {
            const inner = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{q.name}</p>
                  {q.why && <p className="truncate text-xs text-muted-foreground">{q.why}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {q.ref && <span className="font-mono text-2xs text-info">{q.ref}</span>}
                  {q.urgency && (
                    <span className={`rounded-full border px-2 py-0.5 text-2xs ${urgencyTone[q.urgency] ?? urgencyTone.baja}`}>
                      {q.urgency}
                    </span>
                  )}
                </div>
              </>
            )
            const cls =
              'flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40'
            return q.ref?.startsWith('HLX-') ? (
              <a key={i} href={`${LINEAR_BASE}${q.ref}`} target="_blank" rel="noopener noreferrer" className={cls}>
                {inner}
              </a>
            ) : (
              <div key={i} className={cls}>
                {inner}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
