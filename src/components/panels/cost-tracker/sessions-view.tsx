'use client'

import { useTranslations } from 'next-intl'
import { formatNumber, formatCost, getModelDisplayName } from './helpers'
import type { SessionCostEntry } from './types'

interface Props {
  sessionCosts: SessionCostEntry[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessions: any[]
  sessionSort: 'cost' | 'tokens' | 'requests' | 'recent'
  setSessionSort: (s: 'cost' | 'tokens' | 'requests' | 'recent') => void
}

export function SessionsView({ sessionCosts, sessions, sessionSort, setSessionSort }: Props) {
  const t = useTranslations('costTracker')

  const sorted = [...sessionCosts].sort((a, b) => {
    switch (sessionSort) {
      case 'cost': return b.totalCost - a.totalCost
      case 'tokens': return b.totalTokens - a.totalTokens
      case 'requests': return b.requestCount - a.requestCount
      case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
      default: return 0
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{t('sortBy')}:</span>
        {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSessionSort(s)}
            className={`px-2 py-1 text-xs rounded ${sessionSort === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <p className="text-lg mb-1">{t('noSessionCostData')}</p>
          <p className="text-sm">{t('noSessionCostDataDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(entry => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sessionInfo = sessions.find((s: any) => s.id === entry.sessionId)
            return (
              <div key={entry.sessionId} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {entry.sessionKey || sessionInfo?.key || entry.sessionId}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {sessionInfo?.active && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                      )}
                      <span>{sessionInfo?.active ? t('activeStatus') : t('inactiveStatus')}</span>
                      {entry.model && <span>| {getModelDisplayName(entry.model)}</span>}
                      {sessionInfo?.kind && <span>| {sessionInfo.kind}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold text-foreground">{formatCost(entry.totalCost)}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(entry.totalTokens)} tokens</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">
                  <div><span className="font-medium text-foreground">{entry.requestCount}</span> {t('requests')}</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span> {t('inShort')}</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span> {t('outShort')}</div>
                  <div>
                    {entry.totalTokens > 0
                      ? <span className="font-medium text-foreground">{formatCost(entry.totalCost / entry.requestCount)}</span>
                      : '-'} {t('avgPerReq')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
