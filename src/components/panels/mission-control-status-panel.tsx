'use client'

import { useState, useCallback, useEffect } from 'react'
import { Loader } from '@/components/ui/loader'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface ApprovalGate {
  gate_id: string
  action: string
  status: string
  reason: string
  approval_required: boolean
  approval_granted: boolean
  authority: string
}

interface BotResult {
  agent: string
  status: string
  risk_level: number
}

interface GovernorState {
  agent: string
  label: string
  status: 'PASS' | 'WARN' | 'FAIL'
  risk_level: number
  timestamp: string
  repo: string
  repo_state: {
    branch_current: string | null
    is_main: boolean
    working_tree_clean: boolean
    ahead_of_upstream?: number
    behind_upstream?: number
  }
  pr_state: {
    number: number | null
    state: string | null
    mergeable: string | null
    changed_files: number | null
  }
  validation_state: {
    preflight_passed: boolean
    all_validations_passed: boolean
  }
  bot_results: Record<string, BotResult>
  approval_gates: ApprovalGate[]
  next_action: string
  next_action_description: string
  confidence: number
  commands: string[]
  stop_conditions: string[]
  notes: string[]
  metadata: { execution_time_ms: number }
  error?: { message: string }
}

const STATUS_STYLES: Record<string, string> = {
  PASS: 'text-green-400 bg-green-400/10 border-green-400/20',
  WARN: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  FAIL: 'text-red-400 bg-red-400/10 border-red-400/20',
}

const RISK_TEXT: Record<number, string> = {
  0: 'text-green-400',
  1: 'text-yellow-400',
  2: 'text-orange-400',
  3: 'text-red-400',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.FAIL
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      {status}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</div>
      {children}
    </div>
  )
}

export function MissionControlStatusPanel() {
  const [data, setData] = useState<GovernorState | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      setFetchError(null)
      const res = await fetch('/api/mission-control/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as GovernorState
      setData(json)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])
  useSmartPoll(fetchStatus, 30000, { pauseWhenConnected: true })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader variant="inline" label="Loading governor state..." />
      </div>
    )
  }

  if (fetchError || !data) {
    return (
      <div className="p-4">
        <div
          className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm"
          role="alert"
        >
          {fetchError ?? 'No data received'}
        </div>
      </div>
    )
  }

  const firstCommand = data.commands?.[0]
  const botEntries = Object.entries(data.bot_results ?? {})
  const riskClass = RISK_TEXT[data.risk_level] ?? 'text-muted-foreground'

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
        <div>
          <h2 className="text-xl font-bold text-foreground">Mission Control Status</h2>
          <div className="text-xs text-muted-foreground mt-0.5">
            {data.timestamp ? new Date(data.timestamp).toLocaleString() : '—'}
          </div>
        </div>
        <span className="text-xs font-bold tracking-widest text-amber-400 border border-amber-400/30 bg-amber-400/10 px-2 py-1 rounded">
          OBSERVE ONLY
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Status summary */}
        <Section title="Status">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={data.status} />
            <span className={`text-sm font-medium ${riskClass}`}>
              Risk {data.risk_level}/3
            </span>
            <span className="text-sm text-muted-foreground">
              Confidence {Math.round((data.confidence ?? 0) * 100)}%
            </span>
          </div>
        </Section>

        {/* Repository / branch */}
        <Section title="Repository">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Branch</span>
            <span className="font-mono text-foreground">{data.repo_state?.branch_current ?? '—'}</span>
            <span className="text-muted-foreground">Working tree</span>
            <span className={data.repo_state?.working_tree_clean ? 'text-green-400' : 'text-red-400'}>
              {data.repo_state?.working_tree_clean ? 'clean' : 'dirty'}
            </span>
            {data.pr_state?.number != null && (
              <>
                <span className="text-muted-foreground">PR</span>
                <span className="text-foreground">
                  #{data.pr_state.number} ({data.pr_state.state})
                </span>
              </>
            )}
          </div>
        </Section>

        {/* Next action */}
        <Section title="Next Action">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm text-foreground bg-black/20 px-2 py-0.5 rounded">
              {data.next_action}
            </code>
          </div>
          {data.next_action_description && (
            <div className="text-sm text-muted-foreground">{data.next_action_description}</div>
          )}
        </Section>

        {/* Approval gates */}
        {(data.approval_gates?.length ?? 0) > 0 && (
          <Section title={`Approval Gates (${data.approval_gates.length})`}>
            <div className="text-xs text-amber-400/80 mb-2">
              Approval required — not executable here
            </div>
            <div className="space-y-2">
              {data.approval_gates.map((gate) => (
                <div key={gate.gate_id} className="text-sm border border-border rounded p-2">
                  <div className="font-medium text-foreground">{gate.action}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{gate.reason}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Authority: {gate.authority}
                  </div>
                  <div className={`text-xs mt-1 ${gate.approval_granted ? 'text-green-400' : 'text-yellow-400'}`}>
                    {gate.approval_granted ? 'Approved' : 'Awaiting approval'}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Stop conditions */}
        {(data.stop_conditions?.length ?? 0) > 0 && (
          <Section title={`Stop Conditions (${data.stop_conditions.length})`}>
            <ul className="space-y-1">
              {data.stop_conditions.map((cond, i) => (
                <li key={i} className="text-sm text-red-400 flex gap-2">
                  <span aria-hidden>!</span>
                  <span>{cond}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Bot results summary */}
        {botEntries.length > 0 && (
          <Section title="Bot Results">
            <div className="space-y-1">
              {botEntries.map(([key, bot]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground truncate max-w-[60%]">
                    {bot.agent ?? key}
                  </span>
                  <StatusBadge status={bot.status} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* First command — display/copy only, no execution */}
        {firstCommand && (
          <Section title="Suggested Command">
            <div className="text-xs text-amber-400/80 mb-1">
              Copy only — no execution controls exposed
            </div>
            <pre className="text-xs font-mono bg-black/20 text-foreground p-2 rounded overflow-x-auto whitespace-pre-wrap break-all select-all">
              {firstCommand}
            </pre>
          </Section>
        )}
      </div>
    </div>
  )
}
