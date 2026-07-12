'use client'

// Flota launchd de Helix (HLX-298 + F4/HLX-292): historial, learnings y acciones
// con confirmación. Vive dentro del panel Cron — los crons OpenClaw (jobs.json)
// y la flota launchd del Mac son dos poblaciones distintas; esta sección cubre
// la segunda.

import { useCallback, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface FleetEntry {
  label: string
  pid: number | null
  lastExit: number | null
  outTail: string[]
  errTail: string[]
  learnings: string
}

export function LaunchdFleet() {
  const [fleet, setFleet] = useState<FleetEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/launchd')
      const data = await res.json()
      if (data.error) setError(data.error)
      else setError(null)
      setFleet(data.fleet ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar flota')
    }
  }, [])

  useSmartPoll(fetchFleet, 60000)

  const kickstart = async (label: string) => {
    setBusy(label)
    setConfirming(null)
    try {
      const res = await fetch('/api/launchd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kickstart', label }),
      })
      const data = await res.json()
      if (data.error) setError(data.error)
      await fetchFleet()
    } finally {
      setBusy(null)
    }
  }

  const saveLearning = async (label: string) => {
    await fetch('/api/launchd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'learning', label, note: noteDraft }),
    })
    setEditingNote(null)
    await fetchFleet()
  }

  const anomalies = (fleet ?? []).filter(f => f.lastExit !== null && f.lastExit !== 0).length

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider">Flota Helix (launchd)</h3>
        <span className="font-mono text-2xs text-muted-foreground tabular-nums">
          {fleet ? `${fleet.length} agentes` : '…'}
          {anomalies > 0 && <span className="ml-2 text-warning">· {anomalies} con exit ≠ 0</span>}
        </span>
      </div>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {!fleet && !error && <p className="text-xs text-muted-foreground">Cargando flota…</p>}

      {fleet && (
        <ul className="divide-y divide-border/60">
          {fleet.map(f => {
            const bad = f.lastExit !== null && f.lastExit !== 0
            const isOpen = open === f.label
            return (
              <li key={f.label} className="py-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <button
                    onClick={() => setOpen(isOpen ? null : f.label)}
                    className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:text-primary transition-colors duration-150"
                    aria-expanded={isOpen}
                  >
                    {f.label}
                  </button>
                  <span className={`shrink-0 font-mono text-2xs tabular-nums ${bad ? 'text-warning' : 'text-muted-foreground'}`}>
                    {f.pid ? `pid ${f.pid}` : f.lastExit === null ? '—' : `exit ${f.lastExit}`}
                  </span>
                  {confirming === f.label ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => kickstart(f.label)}
                        className="rounded border border-warning/50 px-1.5 text-2xs text-warning hover:bg-warning/10"
                      >
                        confirmar
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="rounded border border-border px-1.5 text-2xs text-muted-foreground"
                      >
                        no
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirming(f.label)}
                      disabled={busy === f.label}
                      className="shrink-0 rounded border border-border px-1.5 text-2xs text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-40"
                    >
                      {busy === f.label ? 'corriendo…' : 'run'}
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 space-y-2 pl-1">
                    {(f.errTail.length > 0 || f.outTail.length > 0) ? (
                      <pre className="max-h-36 overflow-auto rounded bg-secondary/40 p-2 text-2xs leading-relaxed text-muted-foreground">
                        {[...f.errTail.map(l => `err│ ${l}`), ...f.outTail.map(l => `out│ ${l}`)].join('\n')}
                      </pre>
                    ) : (
                      <p className="text-2xs text-muted-foreground italic">sin logs recientes</p>
                    )}
                    {editingNote === f.label ? (
                      <div className="space-y-1">
                        <textarea
                          value={noteDraft}
                          onChange={e => setNoteDraft(e.target.value)}
                          rows={3}
                          className="w-full rounded border border-border bg-background p-2 font-sans text-xs"
                          placeholder="Qué aprendimos de este cron (incidentes, calibraciones, falsos positivos)…"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => saveLearning(f.label)} className="rounded border border-primary/50 px-2 py-0.5 text-2xs text-primary">
                            guardar
                          </button>
                          <button onClick={() => setEditingNote(null)} className="rounded border border-border px-2 py-0.5 text-2xs text-muted-foreground">
                            cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 font-sans text-xs text-muted-foreground">
                          {f.learnings || <span className="italic">sin learnings registrados</span>}
                        </p>
                        <button
                          onClick={() => { setEditingNote(f.label); setNoteDraft(f.learnings) }}
                          className="shrink-0 rounded border border-border px-1.5 text-2xs text-muted-foreground hover:text-foreground"
                        >
                          editar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
