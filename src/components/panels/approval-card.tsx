'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { ExecApprovalRequest } from '@/store'
import { RISK_BORDER, RISK_BADGE, timeAgo } from './exec-approval-types'

interface ApprovalCardProps {
  approval: ExecApprovalRequest
  onAction: (id: string, decision: 'allow-once' | 'allow-always' | 'deny') => void
}

export function ApprovalCard({ approval, onAction }: ApprovalCardProps): React.JSX.Element {
  const t = useTranslations('execApproval')
  const riskBorder = RISK_BORDER[approval.risk]
  const riskBadge = RISK_BADGE[approval.risk]
  const isPending = approval.status === 'pending'
  const isExpired = approval.status === 'expired'

  return (
    <div className={`rounded-lg border border-border bg-card p-4 border-l-4 ${riskBorder}`}>
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

      {approval.command && (
        <pre className="bg-secondary rounded p-2 text-xs font-mono overflow-auto max-h-20 text-foreground mb-2 border border-border">
          <code>$ {approval.command}</code>
        </pre>
      )}

      {!approval.command && approval.toolArgs && Object.keys(approval.toolArgs).length > 0 && (
        <pre className="bg-secondary rounded p-2 text-xs font-mono overflow-auto max-h-32 text-foreground mb-2">
          {JSON.stringify(approval.toolArgs, null, 2)}
        </pre>
      )}

      {(approval.cwd || approval.host || approval.resolvedPath) && (
        <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
          {approval.host && <div>Host: <span className="font-mono text-foreground">{approval.host}</span></div>}
          {approval.cwd && <div>CWD: <span className="font-mono text-foreground">{approval.cwd}</span></div>}
          {approval.resolvedPath && <div>Resolved: <span className="font-mono text-foreground">{approval.resolvedPath}</span></div>}
        </div>
      )}

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
