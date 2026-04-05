'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/types/sql'
import type { ExecApprovalRequest } from '@/store'
import type { AllowlistState } from './exec-approval-types'
import { AgentAllowlistCard } from './agent-allowlist-card'

interface AllowlistEditorProps {
  execApprovals: ExecApprovalRequest[]
}

export function AllowlistEditor({ execApprovals }: AllowlistEditorProps): React.JSX.Element {
  const t = useTranslations('execApproval')
  const [agents, setAgents] = useState<AllowlistState>({})
  const [hash, setHash] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [newAgentId, setNewAgentId] = useState('')

  const loadAllowlist = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/exec-approvals?action=allowlist', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setAgents(data.agents ?? {})
      setHash(data.hash ?? '')
      setDirty(false)
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to load allowlist')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAllowlist() }, [loadAllowlist])

  const saveAllowlist = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/exec-approvals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents, hash }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setHash(data.hash ?? '')
      setDirty(false)
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to save allowlist')
    } finally {
      setSaving(false)
    }
  }

  const addAgent = (): void => {
    const id = newAgentId.trim()
    if (!id || agents[id]) return
    setAgents(prev => ({ ...prev, [id]: [] }))
    setNewAgentId('')
    setDirty(true)
  }

  const addPattern = (agentId: string): void => {
    setAgents(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), { pattern: '' }],
    }))
    setDirty(true)
  }

  const updatePattern = (agentId: string, index: number, value: string): void => {
    setAgents(prev => ({
      ...prev,
      [agentId]: prev[agentId].map((p, i) => i === index ? { pattern: value } : p),
    }))
    setDirty(true)
  }

  const removePattern = (agentId: string, index: number): void => {
    setAgents(prev => ({
      ...prev,
      [agentId]: prev[agentId].filter((_, i) => i !== index),
    }))
    setDirty(true)
  }

  const removeAgent = (agentId: string): void => {
    setAgents(prev => {
      const { [agentId]: _removed, ...rest } = prev
      return rest
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
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-center justify-between gap-4">
          <span>{error}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-400 hover:text-red-300" onClick={loadAllowlist}>
            Retry
          </Button>
        </div>
      )}

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
