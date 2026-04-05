'use client'

import React, { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl, type ExecApprovalRequest } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import type { FilterTab, PanelView } from './exec-approval-types'
import { ApprovalCard } from './approval-card'
import { AllowlistEditor } from './allowlist-editor'

export function ExecApprovalPanel(): React.JSX.Element {
  const t = useTranslations('execApproval')
  const { execApprovals, updateExecApproval } = useMissionControl()
  const { sendMessage } = useWebSocket()
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [view, setView] = useState<PanelView>('approvals')

  const pendingCount = execApprovals.filter(a => a.status === 'pending').length

  // Mark expired approvals client-side without mutating originals
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

  const handleAction = (id: string, decision: 'allow-once' | 'allow-always' | 'deny'): void => {
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
      <PanelHeader pendingCount={pendingCount} t={t} />
      <ViewToggle view={view} setView={setView} t={t} />

      {view === 'approvals' ? (
        <ApprovalsView
          filter={filter}
          setFilter={setFilter}
          displayApprovals={displayApprovals}
          onAction={handleAction}
          t={t}
        />
      ) : (
        <AllowlistEditor execApprovals={execApprovals} />
      )}
    </div>
  )
}

// --- Local sub-components (presentation-only, no hooks) ---

interface TranslationFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (key: string, values?: Record<string, any>): string
}

function PanelHeader({ pendingCount, t }: { pendingCount: number; t: TranslationFn }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        {pendingCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400 animate-pulse">
            {t('pendingBadge', { count: pendingCount })}
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">{t('realtimeLabel')}</span>
    </div>
  )
}

function ViewToggle({
  view,
  setView,
  t,
}: {
  view: PanelView
  setView: (v: PanelView) => void
  t: TranslationFn
}): React.JSX.Element {
  return (
    <div className="flex gap-1 mb-4 border-b border-border">
      {(['approvals', 'allowlist'] as const).map(v => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={`px-3 py-1.5 text-sm transition-colors ${
            view === v
              ? 'text-foreground border-b-2 border-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {v === 'approvals' ? t('viewApprovals') : t('viewAllowlist')}
        </button>
      ))}
    </div>
  )
}

function ApprovalsView({
  filter,
  setFilter,
  displayApprovals,
  onAction,
  t,
}: {
  filter: FilterTab
  setFilter: (f: FilterTab) => void
  displayApprovals: ExecApprovalRequest[]
  onAction: (id: string, decision: 'allow-once' | 'allow-always' | 'deny') => void
  t: TranslationFn
}): React.JSX.Element {
  return (
    <>
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

      {displayApprovals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {filter === 'pending' ? t('noPendingApprovals') : t('noApprovals')}
        </div>
      ) : (
        <div className="space-y-3">
          {displayApprovals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onAction={onAction} />
          ))}
        </div>
      )}
    </>
  )
}
