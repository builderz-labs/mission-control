'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createClientLogger } from '@/lib/client-logger'
import type { StandupReport, StandupHistory } from './standup-types'
import { formatDisplayDate } from './standup-types'
import { exportStandupReport } from './standup-export'
import { StandupSummaryStats } from './standup-summary-stats'
import { TeamAccomplishments, TeamBlockers, OverdueTasks } from './standup-team-sections'
import { StandupAgentReport } from './standup-agent-report'
import { StandupHistoryView } from './standup-history-view'

const log = createClientLogger('StandupPanel')

function useStandupData(view: 'current' | 'history') {
  const [standupReport, setStandupReport] = useState<StandupReport | null>(null)
  const [standupHistory, setStandupHistory] = useState<StandupHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  const generateStandup = async (date?: string): Promise<void> => {
    const targetDate = date ?? selectedDate
    const today = new Date().toISOString().split('T')[0]
    if (targetDate > today) {
      setError('Cannot generate standup for a future date.')
      return
    }
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/standup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: targetDate }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error('Failed to generate standup')
      const data = await response.json()
      setStandupReport(data.standup)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchHistory = async (): Promise<void> => {
    try {
      const response = await fetch('/api/standup/history', { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('Failed to fetch history')
      const data = await response.json()
      setStandupHistory(data.history || [])
    } catch (err) {
      log.error('Failed to fetch standup history:', err)
    }
  }

  useEffect(() => {
    if (view === 'history') {
      void fetchHistory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  return { standupReport, standupHistory, loading, error, setError, selectedDate, setSelectedDate, generateStandup }
}

function StandupEmptyState({ onGenerate, loading }: { readonly onGenerate: () => void; readonly loading: boolean }): React.ReactElement {
  const t = useTranslations('standup')
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="w-14 h-14 rounded-lg bg-surface-2 flex items-center justify-center mx-auto mb-4">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground/40">
          <path d="M2 12V4h3l2-2h2l2 2h3v8H2z" />
          <path d="M5 8h6M8 5v6" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{t('noStandupGenerated')}</h3>
      <p className="text-sm text-muted-foreground mb-4">{t('selectDatePrompt')}</p>
      <Button onClick={onGenerate} disabled={loading}>{t('generateToday')}</Button>
    </div>
  )
}

function StandupCurrentView({ report, onGenerate, loading }: { readonly report: StandupReport | null; readonly onGenerate: () => void; readonly loading: boolean }): React.ReactElement {
  const t = useTranslations('standup')
  if (!report) return <StandupEmptyState onGenerate={onGenerate} loading={loading} />

  return (
    <div className="p-4 space-y-6">
      <div className="bg-card rounded-lg p-4 border border-border">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t('standupFor', { date: formatDisplayDate(report.date) })}
        </h3>
        <p className="text-muted-foreground text-sm">
          {t('generatedOn', { date: new Date(report.generatedAt).toLocaleString() })}
        </p>
      </div>

      <StandupSummaryStats summary={report.summary} />
      <TeamAccomplishments accomplishments={report.teamAccomplishments} />
      <TeamBlockers blockers={report.teamBlockers} />
      <OverdueTasks tasks={report.overdueTasks} />

      <div className="space-y-4">
        <h4 className="text-lg font-semibold text-foreground">👥 {t('individualReports')}</h4>
        {report.agentReports.map(agentReport => (
          <StandupAgentReport key={agentReport.agent.name} report={agentReport} />
        ))}
      </div>
    </div>
  )
}

export function StandupPanel(): React.ReactElement {
  const t = useTranslations('standup')
  const [view, setView] = useState<'current' | 'history'>('current')
  const { standupReport, standupHistory, loading, error, setError, selectedDate, setSelectedDate, generateStandup } = useStandupData(view)

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-secondary rounded-lg p-1">
            <Button onClick={() => setView('current')} variant={view === 'current' ? 'default' : 'ghost'} size="sm">
              {t('viewCurrent')}
            </Button>
            <Button onClick={() => setView('history')} variant={view === 'history' ? 'default' : 'ghost'} size="sm">
              {t('viewHistory')}
            </Button>
          </div>
          {view === 'current' && (
            <>
              <input
                type="date"
                value={selectedDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-surface-1 text-foreground rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 border border-border"
              />
              <Button onClick={() => void generateStandup()} disabled={loading} size="sm" className="flex items-center gap-2">
                {loading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground" />}
                {loading ? t('generating') : t('generate')}
              </Button>
              {standupReport && (
                <Button onClick={() => exportStandupReport(standupReport)} variant="success" size="sm">
                  {t('export')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button onClick={() => setError(null)} variant="ghost" size="icon-xs" className="text-red-400/60 hover:text-red-400 ml-2 w-5 h-5">×</Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {view === 'current'
          ? <StandupCurrentView report={standupReport} onGenerate={() => void generateStandup()} loading={loading} />
          : <div className="p-4"><StandupHistoryView history={standupHistory} /></div>
        }
      </div>
    </div>
  )
}
