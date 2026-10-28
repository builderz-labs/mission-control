'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

interface LearningSummary {
  events: number
  candidates: number
  active_candidates: number
  evidence: number
  measured_paid_usd_recent: number
  default_policy: {
    mode: string
    passive_logging: boolean
    deterministic_analysis: boolean
    reflection_min_new_evidence: number
    paid_api_default_hard_cap_usd_per_day: number
    optimizer_auto_run: boolean
  }
}

interface ExperienceRow {
  id: number
  experience_id: string
  factory_instance_id: string | null
  stage_id: string | null
  action_type: string
  worker_kind: string | null
  outcome: string | null
  source_revision: string | null
  observed_at: number
}

interface CandidateRow {
  candidate_id: string
  scope: string
  target: string
  status: string
  hypothesis: string
  sample_size: number
  confidence_label: string | null
  promotion_state: string
  change_ref: string | null
  rollback_target: string | null
  evidence_count: number
  eval_ready: boolean
  has_rollback_target: boolean
  review_required: boolean
  approval_required: boolean
  under_observation: boolean
  updated_at: number
}

interface DeterministicAnalysis {
  window_events: number
  reflection_threshold: number
  factory_rollups: Array<{
    factory_instance_id: string
    events: number
    success: number
    mixed: number
    failure: number
    last_observed_at: number
    reflection_eligible: boolean
    evidence_needed: number
  }>
  recurring_check_failures: Array<{
    check_id: string
    count: number
    factories: string[]
    last_observed_at: number
    recurring: boolean
  }>
}

interface CandidateSignal {
  subject_key: string
  evidence_count: number
  positive: number
  negative: number
  mixed: number
  informational: number
  unique_sources: number
  evidence_types: string[]
  last_observed_at: number
  has_active_candidate: boolean
  candidate_ready: boolean
  evidence_needed: number
}

interface LearningEvidenceRow {
  evidence_id: string
  evidence_type: string
  source_type: string
  source_ref: string
  candidate_id: string | null
  skill_ref: string | null
  result: string | null
  observed_at: number
}

interface LearningPayload {
  summary: LearningSummary
  analysis: DeterministicAnalysis
  candidate_signals: CandidateSignal[]
  evidence: LearningEvidenceRow[]
  experiences: ExperienceRow[]
  candidates: CandidateRow[]
}

interface BrainStatus {
  connected: boolean
  readable: boolean
  root: string
  entry: string
  entry_path: string
  modified: number | null
  size: number | null
  routes: Record<string, string>
}

interface SkillMemoryPayload {
  health: {
    installed: boolean
    version: string | null
    database_exists: boolean
    schema_version: string | null
    total: number
    skills: number
    history_rows: number
    semantic_status: string | null
    chain_ok: boolean | null
    detail: string | null
  }
  policy: {
    integration_mode: string
    auto_trust: boolean
    hooks_enabled_by_ai_ops: boolean
    agent_mcp_wiring_enabled_by_ai_ops: boolean
    semantic_embeddings_enabled: boolean
    reinforcement_requires_external_evidence: boolean
    paid_model_calls_required: boolean
  }
}

function outcomeTone(outcome: string | null) {
  if (outcome === 'success') return 'text-emerald-500'
  if (outcome === 'failure') return 'text-red-400'
  if (outcome === 'mixed') return 'text-amber-500'
  return 'text-muted-foreground'
}

export function LearningPanel() {
  const [data, setData] = useState<LearningPayload | null>(null)
  const [skillMemory, setSkillMemory] = useState<SkillMemoryPayload | null>(null)
  const [brain, setBrain] = useState<BrainStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const [learningData, skillMemoryData, brainData] = await Promise.all([
        apiFetch<LearningPayload>('/api/learning?limit=40'),
        apiFetch<SkillMemoryPayload>('/api/skill-memory'),
        apiFetch<BrainStatus>('/api/organizational-brain'),
      ])
      setData(learningData)
      setSkillMemory(skillMemoryData)
      setBrain(brainData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Learning data load failed')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const summary = data?.summary

  return (
    <div className="p-5 space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">AI Control Tower</div>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">Learning</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              먼저 싸게 관찰하고, 로컬에서 패턴을 모은 뒤, 충분한 evidence가 있을 때만 AI reflection을 사용합니다.
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['Experience', summary?.events ?? 0],
            ['Candidates', summary?.active_candidates ?? 0],
            ['Evidence', summary?.evidence ?? 0],
            ['Reflection threshold', summary?.default_policy.reflection_min_new_evidence ?? 5],
            ['Measured paid $', (summary?.measured_paid_usd_recent ?? 0).toFixed(2)],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-background/50 px-4 py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>

        {summary && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-500">
              Passive logging ON
            </span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-500">
              Deterministic analysis ON
            </span>
            <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
              Paid API default cap $ {summary.default_policy.paid_api_default_hard_cap_usd_per_day}/day
            </span>
            <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
              Optimizer auto-run OFF
            </span>
          </div>
        )}
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Organizational Brain</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Obsidian AGENT_BRAIN.md를 공통 entry point로 사용합니다. 전체 Vault를 무차별 ingest하지 않고 관련 Project/Department만 선택적으로 읽습니다.
            </p>
          </div>
          <span className={"rounded-md border px-2 py-1 text-xs font-medium " + (brain?.readable ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-red-500/30 bg-red-500/10 text-red-400')}>
            {brain?.readable ? 'Connected' : 'Unavailable'}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-muted/30 px-3 py-3"><div className="text-sm font-semibold text-foreground">{brain?.entry || 'AGENT_BRAIN.md'}</div><div className="text-[11px] text-muted-foreground">Entry point</div></div>
          <div className="rounded-xl bg-muted/30 px-3 py-3"><div className="truncate text-sm font-semibold text-foreground">{brain?.root || '—'}</div><div className="text-[11px] text-muted-foreground">Obsidian root</div></div>
          <div className="rounded-xl bg-muted/30 px-3 py-3"><div className="text-sm font-semibold text-foreground">{brain?.modified ? new Date(brain.modified).toLocaleString() : '—'}</div><div className="text-[11px] text-muted-foreground">Last modified</div></div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">Read-only bridge · selective retrieval · writes require explicit approved action</div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Skill Memory</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              skillmem은 현재 read-only compatibility mode입니다. Agent hook/MCP wiring과 auto-trust는 아직 켜지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={"rounded-md border px-2 py-1 " + (skillMemory?.health.installed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-red-500/30 bg-red-500/10 text-red-400')}>
              {skillMemory?.health.installed ? `skillmem ${skillMemory.health.version || ''}` : 'Not installed'}
            </span>
            <span className={"rounded-md border px-2 py-1 " + (skillMemory?.health.chain_ok === true ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-border text-muted-foreground')}>
              Chain {skillMemory?.health.chain_ok === true ? 'OK' : '—'}
            </span>
            <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">Read-only</span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Stored', skillMemory?.health.total ?? 0],
            ['Skills', skillMemory?.health.skills ?? 0],
            ['History', skillMemory?.health.history_rows ?? 0],
            ['Schema', skillMemory?.health.schema_version || '—'],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-muted/30 px-3 py-3">
              <div className="text-lg font-semibold text-foreground">{value}</div>
              <div className="text-[11px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Semantic retrieval: {skillMemory?.health.semantic_status || '—'} · auto-trust OFF · external evidence required
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Deterministic Signals</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            AI 호출 없이 Experience를 집계합니다. evidence threshold에 도달해도 reflection은 자동 실행하지 않습니다.
          </p>
        </div>
        {!data?.analysis.factory_rollups.length ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">집계할 Experience가 없습니다.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.analysis.factory_rollups.map((rollup) => (
              <div key={rollup.factory_instance_id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_90px_170px] md:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{rollup.factory_instance_id}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    success {rollup.success} · mixed {rollup.mixed} · failure {rollup.failure}
                  </div>
                </div>
                <div className="text-sm md:text-right">{rollup.events} evidence</div>
                <div className="md:text-right">
                  {rollup.reflection_eligible ? (
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-500">
                      Reflection eligible
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{rollup.evidence_needed} more to threshold</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {Boolean(data?.analysis.recurring_check_failures.some((item) => item.recurring)) && (
          <div className="border-t border-border px-5 py-4">
            <div className="text-xs font-semibold text-foreground">Recurring failed checks</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {data?.analysis.recurring_check_failures.filter((item) => item.recurring).map((item) => (
                <span key={item.check_id} className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1 text-xs text-red-400">
                  {item.check_id} × {item.count}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Candidate Signals</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Typed evidence가 같은 subject에 5개 이상, 문제 신호가 2개 이상, 서로 다른 source가 2개 이상일 때만 후보 생성 준비 상태로 표시합니다.
          </p>
        </div>
        {!data?.candidate_signals.length ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">아직 candidate signal이 없습니다.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.candidate_signals.map((signal) => (
              <div key={signal.subject_key} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_160px_170px] md:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{signal.subject_key}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    positive {signal.positive} · negative {signal.negative} · mixed {signal.mixed} · sources {signal.unique_sources}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground md:text-right">{signal.evidence_types.join(', ')}</div>
                <div className="md:text-right">
                  {signal.candidate_ready ? (
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-500">
                      Candidate ready
                    </span>
                  ) : signal.has_active_candidate ? (
                    <span className="text-xs text-muted-foreground">Active candidate exists</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{signal.evidence_needed} more to threshold</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {Boolean(data?.evidence.length) && (
          <div className="border-t border-border px-5 py-4">
            <div className="text-xs font-semibold text-foreground">Recent typed evidence</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {data?.evidence.slice(0, 8).map((item) => (
                <span key={item.evidence_id} className="rounded-md border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
                  {item.evidence_type} · {item.result || 'observed'}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Improvement Queue</h2>
          <p className="mt-1 text-xs text-muted-foreground">Evidence가 없는 자기평가는 승격되지 않습니다.</p>
        </div>
        {!data?.candidates.length ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            아직 개선 후보가 없습니다. Experience를 먼저 축적합니다.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.candidates.map((candidate) => (
              <div key={candidate.candidate_id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">{candidate.scope}</span>
                  <span>{candidate.target}</span>
                  <span>n={candidate.sample_size}</span>
                  <span>{candidate.confidence_label || 'unrated'}</span>
                  <span className="rounded-md border border-border px-2 py-1 text-foreground">{candidate.status}</span>
                  <span>{candidate.promotion_state}</span>
                  <span>evidence {candidate.evidence_count}</span>
                  <span>eval {candidate.eval_ready ? 'ready' : 'pending'}</span>
                  <span>rollback {candidate.has_rollback_target ? 'set' : 'missing'}</span>
                  {candidate.review_required && <span>review required</span>}
                  {candidate.approval_required && <span>approval required</span>}
                  {candidate.under_observation && <span>under observation</span>}
                </div>
                <div className="mt-2 text-sm font-medium text-foreground">{candidate.hypothesis}</div>
                {(candidate.change_ref || candidate.rollback_target) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    {candidate.change_ref && <span>change: {candidate.change_ref}</span>}
                    {candidate.rollback_target && <span>rollback: {candidate.rollback_target}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Recent Experience</h2>
          <p className="mt-1 text-xs text-muted-foreground">Factory 실행/상태에서 수집한 immutable observation입니다.</p>
        </div>
        {!data?.experiences.length ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">아직 Experience가 없습니다.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.experiences.map((event) => (
              <div key={event.experience_id} className="grid gap-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_150px_120px] md:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{event.factory_instance_id || event.action_type}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {event.action_type}{event.stage_id ? ' · ' + event.stage_id : ''}{event.worker_kind ? ' · ' + event.worker_kind : ''}
                  </div>
                </div>
                <div className={'text-xs md:text-right ' + outcomeTone(event.outcome)}>{event.outcome || 'observed'}</div>
                <div className="font-mono text-[11px] text-muted-foreground md:text-right">
                  {event.source_revision?.slice(0, 10) || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
