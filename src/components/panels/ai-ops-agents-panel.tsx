'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface RuntimeStatus {
  id: string
  name: string
  description?: string
  installed: boolean
  version: string | null
  running: boolean
  authenticated: boolean
  authHint?: string
}

interface LocalSession {
  id: string
  kind?: string
  model?: string
  active?: boolean
  lastActivity?: number
  totalTokens?: number
  workingDir?: string
}

interface ClaudeSession {
  session_id: string
  model?: string
  is_active?: number
  last_message_at?: string
  input_tokens?: number
  output_tokens?: number
  project_path?: string
}

function ageLabel(ts?: number | null) {
  if (!ts) return '—'
  const diff = Math.max(0, Date.now() - ts)
  const min = Math.floor(diff / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export function AiOpsAgentsPanel() {
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([])
  const [sessions, setSessions] = useState<LocalSession[]>([])
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch<{ runtimes?: RuntimeStatus[] }>('/api/agent-runtimes'),
      apiFetch<{ sessions?: LocalSession[] }>('/api/sessions'),
      apiFetch<{ sessions?: ClaudeSession[] }>('/api/claude/sessions'),
    ])
      .then(([runtimeData, sessionData, claudeData]) => {
        if (cancelled) return
        setRuntimes(runtimeData.runtimes || [])
        setSessions(sessionData.sessions || [])
        setClaudeSessions(claudeData.sessions || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Agent data load failed')
      })
    return () => { cancelled = true }
  }, [])

  const cards = useMemo(() => {
    const codexSessions = sessions.filter((s) => s.kind === 'codex-cli')
    const latestCodex = Math.max(0, ...codexSessions.map((s) => s.lastActivity || 0))
    const latestClaude = Math.max(0, ...claudeSessions.map((s) => s.last_message_at ? Date.parse(s.last_message_at) : 0))

    return ['claude', 'codex'].map((id) => {
      const runtime = runtimes.find((r) => r.id === id)
      const sessionCount = id === 'claude' ? claudeSessions.length : codexSessions.length
      const activeCount = id === 'claude'
        ? claudeSessions.filter((s) => s.is_active === 1).length
        : codexSessions.filter((s) => s.active).length
      const latest = id === 'claude' ? latestClaude : latestCodex
      const observed = sessionCount > 0
      return {
        id,
        name: runtime?.name || (id === 'claude' ? 'Claude Code' : 'Codex CLI'),
        description: runtime?.description || '',
        installed: runtime?.installed || observed,
        detectedInstalled: runtime?.installed || false,
        authenticated: runtime?.authenticated || observed,
        version: runtime?.version || null,
        running: runtime?.running || activeCount > 0,
        sessionCount,
        activeCount,
        latest,
        observed,
      }
    })
  }, [runtimes, sessions, claudeSessions])

  const otherInstalled = runtimes.filter((r) => !['claude', 'codex'].includes(r.id) && r.installed)

  return (
    <div className="p-5 space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">AI Ops Hub</div>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Agents</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          실제 로컬 실행기와 세션을 기준으로 Claude Code / Codex 상태를 봅니다. Skill 폴더는 Agent로 계산하지 않습니다.
        </p>
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        {cards.map((agent) => (
          <section key={agent.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${agent.running ? 'bg-cyan-400' : agent.installed ? 'bg-emerald-400' : 'bg-muted-foreground'}`} />
                  <h2 className="text-lg font-semibold text-foreground">{agent.name}</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{agent.version || (agent.observed ? '세션 기록으로 감지됨' : '설치 감지 안 됨')}</p>
              </div>
              <span className={`rounded-md border px-2 py-1 text-xs font-medium ${agent.authenticated ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-amber-500/30 bg-amber-500/10 text-amber-500'}`}>
                {agent.authenticated ? 'Ready' : 'Needs auth'}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-muted/30 p-3"><div className="text-lg font-semibold">{agent.sessionCount}</div><div className="text-[11px] text-muted-foreground">Sessions</div></div>
              <div className="rounded-xl bg-muted/30 p-3"><div className="text-lg font-semibold">{agent.activeCount}</div><div className="text-[11px] text-muted-foreground">Active</div></div>
              <div className="rounded-xl bg-muted/30 p-3"><div className="text-sm font-semibold">{ageLabel(agent.latest)}</div><div className="text-[11px] text-muted-foreground">Last activity</div></div>
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Other runtimes</h2>
        <p className="mt-1 text-xs text-muted-foreground">설치된 런타임만 표시합니다. 초기 운영은 Claude Code와 Codex 중심입니다.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {otherInstalled.length === 0
            ? <span className="text-sm text-muted-foreground">추가 런타임 없음</span>
            : otherInstalled.map((runtime) => (
              <span key={runtime.id} className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                {runtime.name}{runtime.version ? ` · ${runtime.version}` : ''}
              </span>
            ))}
        </div>
      </section>
    </div>
  )
}
