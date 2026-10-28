'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface LocalSession {
  id: string
  key?: string
  agent?: string
  kind?: string
  model?: string
  active?: boolean
  startTime?: number
  lastActivity?: number
  totalTokens?: number
  estimatedCost?: number
  workingDir?: string
}

interface ClaudeSession {
  session_id: string
  project_slug?: string
  project_path?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  estimated_cost?: number
  first_message_at?: string
  last_message_at?: string
  is_active?: number
}

function formatInt(value: number) {
  return new Intl.NumberFormat().format(Math.round(value))
}

function formatUsd(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function projectName(path?: string, fallback = 'Unknown') {
  if (!path) return fallback
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.at(-1) || fallback
}

export function AiOpsUsagePanel() {
  const [sessions, setSessions] = useState<LocalSession[]>([])
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch<{ sessions?: LocalSession[] }>('/api/sessions'),
      apiFetch<{ sessions?: ClaudeSession[] }>('/api/claude/sessions'),
    ])
      .then(([sessionData, claudeData]) => {
        if (cancelled) return
        setSessions(sessionData.sessions || [])
        setClaudeSessions(claudeData.sessions || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Usage data load failed')
      })
    return () => { cancelled = true }
  }, [])

  const summary = useMemo(() => {
    const codex = sessions.filter((s) => s.kind === 'codex-cli')
    const codexTokens = codex.reduce((sum, s) => sum + (Number(s.totalTokens) || 0), 0)
    const claudeTokens = claudeSessions.reduce((sum, s) => sum + (Number(s.input_tokens) || 0) + (Number(s.output_tokens) || 0), 0)
    const claudeCost = claudeSessions.reduce((sum, s) => sum + (Number(s.estimated_cost) || 0), 0)
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const codex24h = codex.filter((s) => (s.lastActivity || 0) >= now - day).length
    const claude24h = claudeSessions.filter((s) => s.last_message_at && Date.parse(s.last_message_at) >= now - day).length

    return {
      codexSessions: codex.length,
      codexTokens,
      codex24h,
      claudeSessions: claudeSessions.length,
      claudeTokens,
      claudeCost,
      claude24h,
    }
  }, [sessions, claudeSessions])

  const projects = useMemo(() => {
    const map = new Map<string, { project: string; runtime: string; sessions: number; tokens: number; cost: number }>()

    for (const session of sessions.filter((s) => s.kind === 'codex-cli')) {
      const project = projectName(session.workingDir, session.key || 'Codex')
      const key = `codex:${project}`
      const row = map.get(key) || { project, runtime: 'Codex', sessions: 0, tokens: 0, cost: 0 }
      row.sessions += 1
      row.tokens += Number(session.totalTokens) || 0
      map.set(key, row)
    }

    for (const session of claudeSessions) {
      const project = projectName(session.project_path, session.project_slug || 'Claude')
      const key = `claude:${project}`
      const row = map.get(key) || { project, runtime: 'Claude', sessions: 0, tokens: 0, cost: 0 }
      row.sessions += 1
      row.tokens += (Number(session.input_tokens) || 0) + (Number(session.output_tokens) || 0)
      row.cost += Number(session.estimated_cost) || 0
      map.set(key, row)
    }

    return Array.from(map.values()).sort((a, b) => b.tokens - a.tokens).slice(0, 12)
  }, [sessions, claudeSessions])

  return (
    <div className="p-5 space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">AI Ops Hub</div>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Usage</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          로컬 세션 로그에서 실제로 읽을 수 있는 사용량만 표시합니다. ChatGPT 제품 내부 주간 한도처럼 외부에서 노출되지 않는 값은 추정하지 않습니다.
        </p>
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Codex CLI</h2>
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">local session logs</span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-muted/30 p-3"><div className="text-xl font-semibold">{summary.codexSessions}</div><div className="text-[11px] text-muted-foreground">Sessions</div></div>
            <div className="rounded-xl bg-muted/30 p-3"><div className="text-xl font-semibold">{formatInt(summary.codexTokens)}</div><div className="text-[11px] text-muted-foreground">Logged tokens</div></div>
            <div className="rounded-xl bg-muted/30 p-3"><div className="text-xl font-semibold">{summary.codex24h}</div><div className="text-[11px] text-muted-foreground">Last 24h</div></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">구독/로컬 세션은 비용이 0으로 기록될 수 있어 비용 대신 세션·토큰을 중심으로 봅니다.</p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Claude Code</h2>
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">session scan</span>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2">
            <div className="rounded-xl bg-muted/30 p-3"><div className="text-xl font-semibold">{summary.claudeSessions}</div><div className="text-[11px] text-muted-foreground">Sessions</div></div>
            <div className="rounded-xl bg-muted/30 p-3"><div className="text-xl font-semibold">{formatInt(summary.claudeTokens)}</div><div className="text-[11px] text-muted-foreground">Tokens</div></div>
            <div className="rounded-xl bg-muted/30 p-3"><div className="text-xl font-semibold">{summary.claude24h}</div><div className="text-[11px] text-muted-foreground">Last 24h</div></div>
            <div className="rounded-xl bg-muted/30 p-3"><div className="text-xl font-semibold">{formatUsd(summary.claudeCost)}</div><div className="text-[11px] text-muted-foreground">API-equivalent est.</div></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">비용 값은 세션 메타데이터 기반 API 환산치이며 실제 구독 청구액과 다를 수 있습니다.</p>
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Project usage</h2>
          <p className="mt-1 text-xs text-muted-foreground">세션 로그의 working directory / project path 기준 상위 프로젝트입니다.</p>
        </div>
        {projects.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">사용량 데이터 없음</div>
        ) : (
          <div className="divide-y divide-border">
            {projects.map((row) => (
              <div key={`${row.runtime}:${row.project}`} className="grid grid-cols-[minmax(0,1fr)_90px_110px_130px] items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{row.project}</div>
                  <div className="text-xs text-muted-foreground">{row.runtime}</div>
                </div>
                <div className="text-right text-muted-foreground">{row.sessions} runs</div>
                <div className="text-right font-mono text-xs">{formatInt(row.tokens)}</div>
                <div className="text-right text-xs text-muted-foreground">{row.cost > 0 ? formatUsd(row.cost) : '—'}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
