'use client'

import { useTranslations } from 'next-intl'
import { SessionCostEntry, formatNumber, formatCost, getModelDisplayName } from './token-dashboard-types'

interface Session {
  id: string
  key?: string
  active?: boolean
  kind?: string
}

interface TokenSessionsViewProps {
  sortedSessionCosts: SessionCostEntry[]
  sessionSort: 'cost' | 'tokens' | 'requests' | 'recent'
  sessions: Session[]
  onSortChange: (sort: 'cost' | 'tokens' | 'requests' | 'recent') => void
}

export function TokenSessionsView({
  sortedSessionCosts,
  sessionSort,
  sessions,
  onSortChange,
}: TokenSessionsViewProps): React.JSX.Element {
  const t = useTranslations('tokenDashboard')

  return (
    <div className="space-y-4">
      {/* Sort controls */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{t('sortByLabel')}</span>
        {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
          <button
            key={s}
            onClick={() => onSortChange(s)}
            className={`px-2 py-1 text-xs rounded ${
              sessionSort === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {sortedSessionCosts.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <p className="text-lg mb-1">{t('noSessionCostData')}</p>
          <p className="text-sm">{t('noSessionCostSubtitle')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedSessionCosts.map((entry) => {
            const sessionInfo = sessions.find(s => s.id === entry.sessionId)
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
                      <span>{sessionInfo?.active ? t('sessionActive') : t('sessionInactive')}</span>
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
                  <div>
                    <span className="font-medium text-foreground">{entry.requestCount}</span> {t('requests')}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span>{' '}
                    {t('inSuffix')}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span>{' '}
                    {t('outSuffix')}
                  </div>
                  <div>
                    {entry.totalTokens > 0 ? (
                      <span className="font-medium text-foreground">
                        {formatCost(entry.totalCost / entry.requestCount)}
                      </span>
                    ) : (
                      '-'
                    )}{' '}
                    {t('avgPerRequest')}
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
