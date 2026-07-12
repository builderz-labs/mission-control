'use client'

// Panel GitHub del fork (HLX-291): PRs abiertos/draft de los repos musalabalpha,
// para ver el trabajo de las sesiones de fondo sin ir a github.com.
// Fuente: /api/github?action=prs (reutiliza el cliente src/lib/github.ts).

import { useCallback, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface Pr {
  number: number
  title: string
  draft: boolean
  author: string | null
  branch: string
  url: string
  updatedAt: string
  checks?: { passed: number; failed: number; pending: number } | null
}

interface DriftTarget {
  name: string
  deployBranch: string
  localSha: string | null
  remoteSha: string | null
  inSync: boolean
}

interface RepoPrs {
  repo: string
  prs: Pr[]
  error?: string
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

export function GitHubPrsPanel() {
  const [repos, setRepos] = useState<RepoPrs[] | null>(null)
  const [drift, setDrift] = useState<DriftTarget[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/github?action=prs')
      const data = await res.json()
      if (data.error) {
        setNotice(data.error)
      } else {
        setNotice(null)
      }
      setRepos(data.repos ?? [])
      setOpenCount(data.openCount ?? 0)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar PRs')
    }
    try {
      const res = await fetch('/api/github?action=drift')
      const data = await res.json()
      setDrift(data.targets ?? [])
    } catch {
      setDrift([])
    }
  }, [])

  useSmartPoll(fetchData, 90000)

  const shortRepo = (r: string) => r.replace(/^[^/]+\//, '')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">GitHub — Pull Requests</h2>
          <p className="text-xs text-muted-foreground">
            {openCount} abiertos en los repos del fork · se actualiza cada 90 s
          </p>
        </div>
      </div>

      {drift.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {drift.map(t => (
            <span
              key={t.name}
              className={`rounded border px-2 py-1 font-mono text-2xs ${
                t.inSync
                  ? 'border-success/40 text-success'
                  : 'border-warning/40 text-warning'
              }`}
              title={`local ${t.localSha?.slice(0, 7) ?? '?'} vs ${t.deployBranch} ${t.remoteSha?.slice(0, 7) ?? '?'}`}
            >
              {t.name}: {t.inSync ? 'deploy en sync' : `drift vs ${t.deployBranch}`}
            </span>
          ))}
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          {notice}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!repos && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {repos && (
        <div className="grid grid-cols-1 gap-3">
          {repos.map(r => (
            <div key={r.repo} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-mono text-sm font-semibold">{shortRepo(r.repo)}</h3>
                <span className="text-xs text-muted-foreground">
                  {r.error ? <span className="text-destructive">{r.error}</span> : `${r.prs.length} abiertos`}
                </span>
              </div>
              {r.prs.length === 0 && !r.error ? (
                <p className="text-xs text-muted-foreground">Sin PRs abiertos.</p>
              ) : (
                <ul className="space-y-1.5">
                  {r.prs.map(pr => (
                    <li key={pr.number} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 font-mono text-xs text-muted-foreground">#{pr.number}</span>
                      {pr.draft && (
                        <span className="mt-0.5 rounded border border-border px-1.5 text-2xs text-muted-foreground">draft</span>
                      )}
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate font-sans text-info hover:underline"
                        title={pr.title}
                      >
                        {pr.title}
                      </a>
                      {pr.checks && (
                        <span
                          className={`shrink-0 rounded border px-1.5 font-mono text-2xs ${
                            pr.checks.failed > 0
                              ? 'border-destructive/40 text-destructive'
                              : pr.checks.pending > 0
                                ? 'border-warning/40 text-warning'
                                : 'border-success/40 text-success'
                          }`}
                          title={`checks: ${pr.checks.passed} ok · ${pr.checks.failed} fail · ${pr.checks.pending} pendientes`}
                        >
                          {pr.checks.failed > 0 ? `✗ ${pr.checks.failed}` : pr.checks.pending > 0 ? `… ${pr.checks.pending}` : `✓ ${pr.checks.passed}`}
                        </span>
                      )}
                      <span className="hidden shrink-0 font-mono text-2xs text-muted-foreground sm:inline">
                        {pr.branch}
                      </span>
                      <span className="shrink-0 text-2xs text-muted-foreground">{timeAgo(pr.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
