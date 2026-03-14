'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl, type ExecApprovalRequest } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { matchesGlobPattern } from '@/lib/exec-approval-utils'

type FilterTab = 'all' | 'pending' | 'resolved'
type PanelView = 'approvals' | 'allowlist'

const RISK_BORDER: Record<ExecApprovalRequest['risk'], string> = {
  low: 'border-l-green-500',
  medium: 'border-l-yellow-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-500',
}

const RISK_BADGE: Record<ExecApprovalRequest['risk'], { bg: string; text: string }> = {
  low: { bg: 'bg-green-500/20', text: 'text-green-400' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  critical: { bg: 'bg-red-500/20', text: 'text-red-400' },
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ExecApprovalPanel() {
  const t = useTranslations('execApproval')
  const { execApprovals, updateExecApproval } = useMissionControl()
  const { sendMessage } = useWebSocket()
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [view, setView] = useState<PanelView>('approvals')

  const pendingCount = execApprovals.filter(a => a.status === 'pending').length

  // Mark expired approvals client-side
  const now = Date.now()
  const displayApprovals = useMemo(() => {
    const withExpiry = execApprovals.map(a => {
      if (a.status === 'pending' && a.expiresAt && a.expiresAt < now) {
        return { ...a, status: 'expired' as const }
      }
      return a
    })

    return withExpiry.filter(a => {
      if (filter === 'pending') return a.status === 'pending'
      if (filter === 'resolved') return a.status !== 'pending'
      return true
    })
  }, [execApprovals, filter, now])

  const handleAction = (id: string, decision: 'allow-once' | 'allow-always' | 'deny') => {
    const sent = sendMessage({
      type: 'req',
      method: 'exec.approval.resolve',
      id: `ea-${Date.now()}`,
      params: { id, decision },
    })

    if (!sent) {
      const action = decision === 'deny' ? 'deny' : decision === 'allow-always' ? 'always_allow' : 'approve'
      fetch('/api/exec-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      }).catch(() => {})
    }

    const newStatus = decision === 'deny' ? 'denied' : 'approved'
    updateExecApproval(id, { status: newStatus as ExecApprovalRequest['status'] })
  }

  return (
    <div className="m-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400 animate-pulse">
              {t('pendingBadge', { count: pendingCount })}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {t('realtimeLabel')}
        </span>
      </div>

      {/* View toggle */}
      <div className="flex gap-1 mb-4 border-b border-border">
        <button
          onClick={() => setView('approvals')}
          className={`px-3 py-1.5 text-sm transition-colors ${
            view === 'approvals'
              ? 'text-foreground border-b-2 border-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('viewApprovals')}
        </button>
        <button
          onClick={() => setView('allowlist')}
          className={`px-3 py-1.5 text-sm transition-colors ${
            view === 'allowlist'
              ? 'text-foreground border-b-2 border-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('viewAllowlist')}
        </button>
      </div>

      {view === 'approvals' ? (
        <>
          {/* Filter tabs */}
          <div className="flex gap-1 mb-4">
            {(['all', 'pending', 'resolved'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-2.5 py-1 text-xs rounded capitalize transition-colors ${
                  filter === tab
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`filter${tab.charAt(0).toUpperCase() + tab.slice(1)}` as 'filterAll' | 'filterPending' | 'filterResolved')}
              </button>
            ))}
          </div>

          {/* Approval list */}
          {displayApprovals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {filter === 'pending'
                ? t('noPendingApprovals')
                : t('noApprovals')}
            </div>
          ) : (
            <div className="space-y-3">
              {displayApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onAction={handleAction}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <AllowlistEditor execApprovals={execApprovals} />
      )}
    </div>
  )
}

type AllowlistState = Record<string, { pattern: string }[]>

function AllowlistEditor({ execApprovals }: { execApprovals: ExecApprovalRequest[] }) {
  const t = useTranslations('execApproval')
  const [agents, setAgents] = useState<AllowlistState>({})
  const [hash, setHash] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [newAgentId, setNewAgentId] = useState('')

  const loadAllowlist = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/exec-approvals?action=allowlist')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setAgents(data.agents ?? {})
      setHash(data.hash ?? '')
      setDirty(false)
    } catch (err: any) {
      setError(err.message || 'Failed to load allowlist')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAllowlist() }, [loadAllowlist])

  const saveAllowlist = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/exec-approvals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents, hash }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setHash(data.hash ?? '')
      setDirty(false)
    } catch (err: any) {
      setError(err.message || 'Failed to save allowlist')
    } finally {
      setSaving(false)
    }
  }

  const addAgent = () => {
    const id = newAgentId.trim()
    if (!id || agents[id]) return
    setAgents(prev => ({ ...prev, [id]: [] }))
    setNewAgentId('')
    setDirty(true)
  }

  const addPattern = (agentId: string) => {
    setAgents(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), { pattern: '' }],
    }))
    setDirty(true)
  }

  const updatePattern = (agentId: string, index: number, value: string) => {
    setAgents(prev => ({
      ...prev,
      [agentId]: prev[agentId].map((p, i) => i === index ? { pattern: value } : p),
    }))
    setDirty(true)
  }

  const removePattern = (agentId: string, index: number) => {
    setAgents(prev => ({
      ...prev,
      [agentId]: prev[agentId].filter((_, i) => i !== index),
    }))
    setDirty(true)
  }

  const removeAgent = (agentId: string) => {
    setAgents(prev => {
      const next = { ...prev }
      delete next[agentId]
      return next
    })
    setDirty(true)
  }

  const recentCommands = useMemo(() => {
    return execApprovals
      .filter(a => a.command)
      .slice(0, 50)
      .map(a => ({ command: a.command!, agentName: a.agentName || a.sessionId }))
  }, [execApprovals])

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground text-sm">{t('loadingAllowlist')}</div>
  }

  const agentIds = Object.keys(agents)

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newAgentId}
          onChange={(e) => setNewAgentId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addAgent()}
          placeholder="Agent ID (e.g. claude, assistant)"
          className="flex-1 bg-secondary border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <Button size="sm" variant="outline" onClick={addAgent} disabled={!newAgentId.trim()}>
          {t('addAgent')}
        </Button>
        <Button size="sm" onClick={saveAllowlist} disabled={!dirty || saving}>
          {saving ? t('saving') : t('save')}
        </Button>
        <Button size="sm" variant="outline" onClick={loadAllowlist} disabled={loading}>
          {t('reload')}
        </Button>
      </div>

      {agentIds.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t('noAgentsConfigured')}
        </div>
      ) : (
        agentIds.map(agentId => (
          <AgentAllowlistCard
            key={agentId}
            agentId={agentId}
            patterns={agents[agentId]}
            recentCommands={recentCommands}
            onAddPattern={() => addPattern(agentId)}
            onUpdatePattern={(i, v) => updatePattern(agentId, i, v)}
            onRemovePattern={(i) => removePattern(agentId, i)}
            onRemoveAgent={() => removeAgent(agentId)}
          />
        ))
      )}
    </div>
  )
}

function AgentAllowlistCard({
  agentId,
  patterns,
  recentCommands,
  onAddPattern,
  onUpdatePattern,
  onRemovePattern,
  onRemoveAgent,
}: {
  agentId: string
  patterns: { pattern: string }[]
  recentCommands: { command: string; agentName: string }[]
  onAddPattern: () => void
  onUpdatePattern: (index: number, value: string) => void
  onRemovePattern: (index: number) => void
  onRemoveAgent: () => void
}) {
  const t = useTranslations('execApproval')
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const previewMatches = useMemo(() => {
    if (previewIndex === null) return []
    const pat = patterns[previewIndex]?.pattern
    if (!pat) return []
    return recentCommands.filter(c => matchesGlobPattern(pat, c.command))
  }, [previewIndex, patterns, recentCommands])

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">{agentId}</span>
          <span className="text-xs text-muted-foreground">
            {patterns.length} pattern{patterns.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onAddPattern}>
            {t('addPattern')}
          </Button>
          <button
            onClick={onRemoveAgent}
            className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-1"
            title="Remove agent"
          >
            x
          </button>
        </div>
      </div>

      {patterns.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          {t('noAllowlistPatterns')}
        </div>
      ) : (
        <div className="space-y-2">
          {patterns.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={entry.pattern}
                onChange={(e) => onUpdatePattern(index, e.target.value)}
                onFocus={() => setPreviewIndex(index)}
                onBlur={() => setPreviewIndex(null)}
                placeholder="e.g. git *, npm install *, ls"
                className="flex-1 font-mono bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <button
                onClick={() => onRemovePattern(index)}
                className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-1.5"
                title="Remove pattern"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pattern preview */}
      {previewIndex !== null && patterns[previewIndex]?.pattern && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="text-xs text-muted-foreground mb-1">
            {t('previewMatches', { count: previewMatches.length })}
          </div>
          {previewMatches.length > 0 && (
            <div className="space-y-1 max-h-24 overflow-auto">
              {previewMatches.slice(0, 5).map((m, i) => (
                <div key={i} className="text-xs font-mono text-green-400 truncate">
                  $ {m.command}
                </div>
              ))}
              {previewMatches.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  {t('andMore', { count: previewMatches.length - 5 })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApprovalCard({
  approval,
  onAction,
}: {
  approval: ExecApprovalRequest
  onAction: (id: string, decision: 'allow-once' | 'allow-always' | 'deny') => void
}) {
  const t = useTranslations('execApproval')
  const riskBorder = RISK_BORDER[approval.risk]
  const riskBadge = RISK_BADGE[approval.risk]
  const isPending = approval.status === 'pending'
  const isExpired = approval.status === 'expired'

  return (
    <div className={`rounded-lg border border-border bg-card p-4 border-l-4 ${riskBorder}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">
            {approval.agentName || approval.sessionId}
          </span>
          <span className="font-mono text-xs bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">
            {approval.toolName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${riskBadge.bg} ${riskBadge.text}`}>
            {approval.risk}
          </span>
          <span className="text-xs text-muted-foreground">
            {timeAgo(approval.createdAt)}
          </span>
        </div>
      </div>

      {/* Command block */}
      {approval.command && (
        <pre className="bg-secondary rounded p-2 text-xs font-mono overflow-auto max-h-20 text-foreground mb-2 border border-border">
          <code>$ {approval.command}</code>
        </pre>
      )}

      {/* Tool args */}
      {!approval.command && approval.toolArgs && Object.keys(approval.toolArgs).length > 0 && (
        <pre className="bg-secondary rounded p-2 text-xs font-mono overflow-auto max-h-32 text-foreground mb-2">
          {JSON.stringify(approval.toolArgs, null, 2)}
        </pre>
      )}

      {/* Metadata */}
      {(approval.cwd || approval.host || approval.resolvedPath) && (
        <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
          {approval.host && <div>Host: <span className="font-mono text-foreground">{approval.host}</span></div>}
          {approval.cwd && <div>CWD: <span className="font-mono text-foreground">{approval.cwd}</span></div>}
          {approval.resolvedPath && <div>Resolved: <span className="font-mono text-foreground">{approval.resolvedPath}</span></div>}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 mt-3">
        {isPending ? (
          <>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => onAction(approval.id, 'allow-once')}
            >
              {t('allowOnce')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAction(approval.id, 'allow-always')}
            >
              {t('alwaysAllow')}
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => onAction(approval.id, 'deny')}
            >
              {t('deny')}
            </Button>
          </>
        ) : isExpired ? (
          <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t('statusExpired')}
          </span>
        ) : (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              approval.status === 'approved'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {approval.status === 'approved' ? t('statusApproved') : t('statusDenied')}
          </span>
        )}
      </div>
    </div>
  )
}
