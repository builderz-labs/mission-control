'use client'

import { useCallback, useEffect, useState } from 'react'

// ── Types ──

interface Debate {
  id: number
  topic: string
  status: 'pending' | 'propose' | 'critique' | 'rebut' | 'vote' | 'concluded' | 'budget_exhausted'
  current_round: number
  max_rounds: number
  token_budget: number
  tokens_used: number
  outcome: string | null
  vote_accept: number
  vote_reject: number
  workspace_id: number
  created_by: string
  created_at: number
  concluded_at: number | null
}

interface Participant {
  debate_id: number
  agent_id: number
  agent_name: string
  joined_at: number
}

interface DebateArgument {
  id: number
  debate_id: number
  agent_id: number
  agent_name: string
  round_number: number
  phase: 'propose' | 'critique' | 'rebut'
  content: string
  confidence: number
  tokens_used: number
  created_at: number
}

interface DebateVote {
  id: number
  debate_id: number
  agent_id: number
  agent_name: string
  vote: 'accept' | 'reject'
  reason: string | null
  created_at: number
}

interface DebateDetail {
  debate: Debate
  participants: Participant[]
  arguments: DebateArgument[]
  votes: DebateVote[]
}

interface Agent {
  id: number
  name: string
  role: string
  status: string
}

// ── Helpers ──

function debateStatusBadge(status: string): string {
  switch (status) {
    case 'propose': return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
    case 'critique': return 'text-orange-400 bg-orange-500/10 border-orange-500/30'
    case 'rebut': return 'text-purple-400 bg-purple-500/10 border-purple-500/30'
    case 'vote': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
    case 'concluded': return 'text-green-400 bg-green-500/10 border-green-500/30'
    case 'budget_exhausted': return 'text-red-400 bg-red-500/10 border-red-500/30'
    default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
  }
}

function phaseBadge(phase: string): string {
  switch (phase) {
    case 'propose': return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
    case 'critique': return 'text-orange-400 bg-orange-500/10 border-orange-500/30'
    case 'rebut': return 'text-purple-400 bg-purple-500/10 border-purple-500/30'
    default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
  }
}

function outcomeBadge(outcome: string): string {
  switch (outcome) {
    case 'accepted': return 'text-green-400 bg-green-500/10 border-green-500/30'
    case 'rejected': return 'text-red-400 bg-red-500/10 border-red-500/30'
    case 'no_consensus': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
    default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
  }
}

function formatTime(epoch: number | null): string {
  if (!epoch) return '-'
  return new Date(epoch * 1000).toLocaleString()
}

function tokenPercent(used: number, budget: number): number {
  if (budget <= 0) return 0
  return Math.min(100, Math.round((used / budget) * 100))
}

// ── New Debate Form ──

function NewDebateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (debateId: number) => void
  onCancel: () => void
}) {
  const [topic, setTopic] = useState('')
  const [maxRounds, setMaxRounds] = useState(3)
  const [tokenBudget, setTokenBudget] = useState(100000)
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => setAgents(data.agents || []))
      .catch(() => {})
  }, [])

  const toggleAgent = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!topic.trim()) { setError('Topic is required'); return }
    if (selectedIds.size < 2) { setError('Select at least 2 participants'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/debates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          participantIds: Array.from(selectedIds),
          maxRounds,
          tokenBudget,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create debate')
      }
      const data = await res.json()
      onCreated(data.debate.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create debate')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">New Debate</h3>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/5 p-2 rounded border border-red-500/20">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Topic</label>
        <input
          type="text"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="What should we debate?"
          className="px-3 py-2 text-sm bg-muted/50 border border-border rounded focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-muted-foreground">Max Rounds</label>
          <input
            type="number"
            value={maxRounds}
            onChange={e => setMaxRounds(Math.max(1, parseInt(e.target.value) || 1))}
            min={1}
            max={10}
            className="px-3 py-2 text-sm bg-muted/50 border border-border rounded focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-muted-foreground">Token Budget</label>
          <input
            type="number"
            value={tokenBudget}
            onChange={e => setTokenBudget(Math.max(100, parseInt(e.target.value) || 100))}
            min={100}
            step={10000}
            className="px-3 py-2 text-sm bg-muted/50 border border-border rounded focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">
          Participants ({selectedIds.size} selected, min 2)
        </label>
        <div className="flex flex-wrap gap-2 max-h-40 overflow-auto">
          {agents.map(a => (
            <button
              key={a.id}
              onClick={() => toggleAgent(a.id)}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                selectedIds.has(a.id)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {a.name}
            </button>
          ))}
          {agents.length === 0 && (
            <span className="text-xs text-muted-foreground">No agents available</span>
          )}
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading || selectedIds.size < 2 || !topic.trim()}
        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create Debate'}
      </button>
    </div>
  )
}

// ── Token Budget Meter ──

function TokenBudgetMeter({ used, budget }: { used: number; budget: number }) {
  const pct = tokenPercent(used, budget)
  const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {used.toLocaleString()} / {budget.toLocaleString()} ({pct}%)
      </span>
    </div>
  )
}

// ── Vote Tally Bar ──

function VoteTallyBar({ accept, reject }: { accept: number; reject: number }) {
  const total = accept + reject
  if (total === 0) return <span className="text-xs text-muted-foreground">No votes yet</span>
  const acceptPct = Math.round((accept / total) * 100)
  const rejectPct = 100 - acceptPct

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-3 rounded-full overflow-hidden">
        {acceptPct > 0 && (
          <div className="bg-green-500 transition-all" style={{ width: `${acceptPct}%` }} />
        )}
        {rejectPct > 0 && (
          <div className="bg-red-500 transition-all" style={{ width: `${rejectPct}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span className="text-green-400">Accept: {accept} ({acceptPct}%)</span>
        <span className="text-red-400">Reject: {reject} ({rejectPct}%)</span>
      </div>
    </div>
  )
}

// ── Debate Detail View ──

function DebateDetailView({
  debateId,
  onBack,
}: {
  debateId: number
  onBack: () => void
}) {
  const [detail, setDetail] = useState<DebateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/debates/${debateId}`)
      if (!res.ok) throw new Error('Failed to fetch debate')
      const data = await res.json()
      setDetail(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [debateId])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const handleAdvance = async () => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/debates/${debateId}/advance`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to advance')
      }
      await fetchDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Advance failed')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading debate...</div>
  if (error) return <div className="p-4 text-sm text-red-400">{error}</div>
  if (!detail) return null

  const { debate, participants, arguments: args, votes } = detail
  const isActive = !['concluded', 'budget_exhausted'].includes(debate.status)

  // Group arguments by round, then by phase
  const rounds: Map<number, Map<string, DebateArgument[]>> = new Map()
  for (const arg of args) {
    if (!rounds.has(arg.round_number)) rounds.set(arg.round_number, new Map())
    const roundMap = rounds.get(arg.round_number)!
    if (!roundMap.has(arg.phase)) roundMap.set(arg.phase, [])
    roundMap.get(arg.phase)!.push(arg)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <button onClick={onBack} className="text-xs text-blue-400 hover:underline self-start">
        Back to Debates
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">{debate.topic}</h3>
        <span className={`text-xs px-2 py-0.5 rounded border ${debateStatusBadge(debate.status)}`}>
          {debate.status}
        </span>
        {debate.outcome && (
          <span className={`text-xs px-2 py-0.5 rounded border ${outcomeBadge(debate.outcome)}`}>
            {debate.outcome}
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="text-xs text-muted-foreground">
        Round {debate.current_round} of {debate.max_rounds} |
        {participants.length} participant{participants.length !== 1 ? 's' : ''} |
        Created by {debate.created_by} | {formatTime(debate.created_at)}
        {debate.concluded_at && <> | Concluded {formatTime(debate.concluded_at)}</>}
      </div>

      {/* Token budget */}
      <TokenBudgetMeter used={debate.tokens_used} budget={debate.token_budget} />

      {/* Participants */}
      <div className="flex gap-2 flex-wrap">
        {participants.map(p => (
          <span
            key={p.agent_id}
            className="text-xs px-2 py-1 rounded border border-border bg-muted/30"
          >
            {p.agent_name}
          </span>
        ))}
      </div>

      {/* Advance button */}
      {isActive && (
        <button
          onClick={handleAdvance}
          disabled={actionLoading}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 self-start"
        >
          {actionLoading ? 'Advancing...' : `Advance Phase`}
        </button>
      )}

      {/* Vote tally */}
      {(debate.status === 'vote' || votes.length > 0) && (
        <div className="border border-border rounded p-3">
          <h4 className="text-sm font-medium mb-2">Votes</h4>
          <VoteTallyBar accept={debate.vote_accept || votes.filter(v => v.vote === 'accept').length} reject={debate.vote_reject || votes.filter(v => v.vote === 'reject').length} />
          {votes.length > 0 && (
            <div className="flex flex-col gap-1 mt-2">
              {votes.map(v => (
                <div key={v.id} className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{v.agent_name}</span>
                  <span className={`px-1.5 py-0.5 rounded border ${v.vote === 'accept' ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-red-400 bg-red-500/10 border-red-500/30'}`}>
                    {v.vote}
                  </span>
                  {v.reason && <span className="text-muted-foreground">{v.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Arguments by round */}
      {Array.from(rounds.entries())
        .sort(([a], [b]) => a - b)
        .map(([roundNum, phases]) => (
        <div key={roundNum} className="border border-border rounded p-3">
          <h4 className="text-sm font-medium mb-2">Round {roundNum}</h4>
          <div className="flex flex-col gap-3">
            {(['propose', 'critique', 'rebut'] as const).map(phase => {
              const phaseArgs = phases.get(phase)
              if (!phaseArgs || phaseArgs.length === 0) return null
              return (
                <div key={phase} className="flex flex-col gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded border self-start ${phaseBadge(phase)}`}>
                    {phase}
                  </span>
                  {phaseArgs.map(arg => (
                    <div key={arg.id} className="ml-2 border-l-2 border-border pl-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{arg.agent_name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          confidence: {Math.round(arg.confidence * 100)}%
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {arg.tokens_used} tokens
                        </span>
                      </div>
                      <p className="text-sm text-foreground/90">{arg.content}</p>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {args.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4">
          No arguments yet. The debate is waiting for participants.
        </div>
      )}
    </div>
  )
}

// ── Debates List Tab ──

function DebatesListTab({
  debates,
  loading,
  onSelect,
  statusFilter,
  setStatusFilter,
  onNewDebate,
}: {
  debates: Debate[]
  loading: boolean
  onSelect: (id: number) => void
  statusFilter: string
  setStatusFilter: (s: string) => void
  onNewDebate: () => void
}) {
  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading debates...</div>

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-2 flex-wrap">
          {['all', 'propose', 'critique', 'rebut', 'vote', 'concluded'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 text-xs rounded border ${
                statusFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={onNewDebate}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          New Debate
        </button>
      </div>

      {debates.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No debates{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.
        </div>
      ) : (
        debates.map(d => (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            className="border border-border rounded p-3 flex items-center justify-between text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{d.topic}</span>
                <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${debateStatusBadge(d.status)}`}>
                  {d.status}
                </span>
                {d.outcome && (
                  <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${outcomeBadge(d.outcome)}`}>
                    {d.outcome}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                Round {d.current_round}/{d.max_rounds} |
                Tokens: {tokenPercent(d.tokens_used, d.token_budget)}% |
                {formatTime(d.created_at)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground ml-2">-&gt;</span>
          </button>
        ))
      )}
    </div>
  )
}

// ── Main Panel ──

export function DebatePanel() {
  const [debates, setDebates] = useState<Debate[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDebates = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/debates?${params}`)
      if (!res.ok) throw new Error('Failed to fetch debates')
      const data = await res.json()
      setDebates(data.debates || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load debates')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchDebates() }, [fetchDebates])

  if (showCreate) {
    return (
      <NewDebateForm
        onCreated={(id) => {
          setShowCreate(false)
          setSelectedId(id)
          fetchDebates()
        }}
        onCancel={() => setShowCreate(false)}
      />
    )
  }

  if (selectedId !== null) {
    return (
      <DebateDetailView
        debateId={selectedId}
        onBack={() => { setSelectedId(null); fetchDebates() }}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-500/5 border-b border-red-500/20">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex border-b border-border">
        <div className="px-4 py-2 text-sm font-medium border-b-2 border-blue-500 text-foreground">
          Debates
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <DebatesListTab
          debates={debates}
          loading={loading}
          onSelect={setSelectedId}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          onNewDebate={() => setShowCreate(true)}
        />
      </div>
    </div>
  )
}
