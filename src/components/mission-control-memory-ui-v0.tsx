#!/usr/bin/env node
/**
 * Mission Control Memory UI v0
 *
 * Provides four panels for managing mission control memory:
 * - Recall: Recall memories for a prompt
 * - Audit: Audit top memories with debug info
 * - Outcome: Mark outcomes for patterns
 * - Status/Health: Memory status and health check
 */

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface MemoryEntry {
  id: number
  content: string
  tags: string
  score: number
  promotion_level: string
  validation_score: number
  causality_score: number
  win_rate: number
  cluster_size: number
  cluster_success_count: number
  cluster_failure_count: number
  cluster_applied_count: number
  cluster_win_count: number
  cluster_loss_count: number
  explanation: string
}

interface AuditEntry extends MemoryEntry {
  promotion_level: string
}

interface RecallResult {
  prompt: string
  runId: string | null
  selected: MemoryEntry[]
  usedPatterns: number[]
  pruned_count: number
  merged_count: number
}

interface AuditResult {
  prompt: string
  runId: string | null
  entries: AuditEntry[]
  summary: {
    total_candidates: number
    returned: number
    pruned_count: number
    merged_count: number
    top_score: number
    warning_count: number
    warnings: Array<{ entryId: number; reason: string; severity: string }>
  }
}

interface StatusResult {
  ok: boolean
  total_memories: number
  by_source: Array<{ source: string; count: number }>
  by_category: Array<{ category: string; count: number }>
  outcome_counts: Record<string, number>
  promoted_counts: Record<string, number>
  recent_count: number
  warnings: string[]
}

interface HealthResult {
  ok: boolean
  checks: {
    memory_db_accessible: boolean
    required_exports_present: boolean
    deterministic_scoring: boolean
    no_nan_score: boolean
  }
  issues: string[]
}

interface MarkOutcomeResult {
  id: number
  outcome: 'success' | 'failure' | 'unknown'
  updated: boolean
  reason?: string
  tags?: string
  outcome_tag?: string
}

interface ReviewEntry {
  id: number
  content: string
  score: number
  promotion_level: string
  validation_score: number
  cluster_success_count: number
  cluster_failure_count: number
  cluster_applied_count: number
  cluster_win_count: number
  cluster_loss_count: number
  warnings: string[]
  reason_summary: string
}

interface ReviewResult {
  entries: ReviewEntry[]
  summary: {
    total_flagged: number
    high_risk: number
    low_validation: number
    failure_heavy: number
    stale_high_confidence: number
  }
}

type TabKey = 'recall' | 'audit' | 'outcome' | 'status' | 'review'

interface TabData {
  type: 'recall' | 'audit' | 'outcome' | 'status' | 'health' | 'review'
  data: RecallResult | AuditResult | StatusResult | HealthResult | ReviewResult | null
  status: 'idle' | 'loading' | 'success' | 'error'
  error?: string
  prompt?: string
}

interface OutcomeForm {
  id: number | string
  outcome: 'success' | 'failure' | 'unknown'
  usedPatterns: string
  primaryPatternId: number | string
  runId: string
}

interface OutcomeFormPartial {
  id?: number | string
  outcome?: 'success' | 'failure' | 'unknown'
  usedPatterns?: string
  primaryPatternId?: number | string
  runId?: string
}

const tabs: { key: TabKey; label: string; description: string }[] = [
  { key: 'recall', label: 'Recall', description: 'Recall memories for a prompt' },
  { key: 'audit', label: 'Audit', description: 'Audit top memories with debug info' },
  { key: 'outcome', label: 'Outcome', description: 'Mark outcomes for patterns' },
  { key: 'status', label: 'Status/Health', description: 'Memory status and health' },
  { key: 'review', label: 'Review', description: 'Flag risky or low-quality memories' },
]

const WARNING_META: Record<string, { label: string; color: string }> = {
  HIGH_SCORE_LOW_VALID:      { label: 'High signal / no validation', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  FAILURE_HEAVY:             { label: 'Failure-heavy',               color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  LOW_USAGE_HIGH_CONFIDENCE: { label: 'Promoted / unused',           color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  STALE_HIGH_CONFIDENCE:     { label: 'Stale promotion',             color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  CROSS_DOMAIN_SUSPECT:      { label: 'Thin content',                color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
}

export default function MissionControlMemoryUIV0() {
  const [activeTab, setActiveTab] = useState<TabKey>('recall')
  const [prompt, setPrompt] = useState('')
  const [limit, setLimit] = useState(3)
  const [agent, setAgent] = useState('cli')
  const [runId, setRunId] = useState('')
  const [tabsData, setTabsData] = useState<Record<TabKey, TabData>>({
    recall: { type: 'recall', data: null, status: 'idle' },
    audit: { type: 'audit', data: null, status: 'idle' },
    outcome: { type: 'outcome', data: null, status: 'idle' },
    status: { type: 'status', data: null, status: 'idle' },
    review: { type: 'review', data: null, status: 'idle' },
  })
  const [ignoredReviewIds, setIgnoredReviewIds] = useState<Set<number>>(new Set())
  const [reviewActionStatus, setReviewActionStatus] = useState<Record<number, string>>({})
  const [outcomeForm, setOutcomeForm] = useState<OutcomeForm | null>(null)
  const latestRequestRef = useRef({ prompt: '', limit: 3, agent: 'cli', runId: '' })

  latestRequestRef.current = { prompt, limit, agent, runId }

  const updateOutcomeForm = (updates: OutcomeFormPartial) => {
    setOutcomeForm(prev => {
      if (!prev) return updates.outcome !== undefined ? { id: 1, outcome: updates.outcome, usedPatterns: '', primaryPatternId: 1, runId: '' } : null
      return { ...prev, ...updates }
    })
  }

  // Call API functions
  const callRecall = useCallback(async (p?: string, l?: number, a?: string, r?: string) => {
    const current = latestRequestRef.current
    const pr = p ?? current.prompt
    const li = l ?? current.limit
    const ag = a ?? current.agent
    const re = r ?? current.runId
    try {
      const res = await fetch('/api/memory/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: pr, agent: ag, limit: li, runId: re }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw err.error || 'Unknown error'
      }
      const data = await res.json()
      setTabsData(prev => ({
        ...prev,
        recall: { ...prev.recall, data, status: 'success' } as any,
      }))
    } catch (err: any) {
      setTabsData(prev => ({
        ...prev,
        recall: { ...prev.recall, status: 'error', error: err },
      }))
    }
  }, [])

  const callAudit = useCallback(async (p?: string, l?: number, a?: string, r?: string) => {
    const current = latestRequestRef.current
    const pr = p ?? current.prompt
    const li = l ?? current.limit
    const ag = a ?? current.agent
    const re = r ?? current.runId
    try {
      const res = await fetch('/api/memory/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: pr, agent: ag, limit: li, runId: re }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw err.error || 'Unknown error'
      }
      const data = await res.json()
      setTabsData(prev => ({
        ...prev,
        audit: { ...prev.audit, data, status: 'success' } as any,
      }))
    } catch (err: any) {
      setTabsData(prev => ({
        ...prev,
        audit: { ...prev.audit, status: 'error', error: err },
      }))
    }
  }, [])

  const callOutcome = async (formData: OutcomeForm) => {
    try {
      const res = await fetch('/api/memory/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!res.ok) {
        const err = await res.json()
        throw err.error || 'Unknown error'
      }
      const result = await res.json()
      setTabsData(prev => ({
        ...prev,
        recall: {
          ...prev.recall,
          data: {
            ...(prev.recall.data || {}),
            usedPatterns: result.usedPatterns,
          } as RecallResult,
        },
      }))
      setTabsData(prev => ({
        ...prev,
        outcome: { ...prev.outcome, data: result, status: 'success' } as any,
      }))
    } catch (err: any) {
      setTabsData(prev => ({
        ...prev,
        outcome: { ...prev.outcome, status: 'error', error: err },
      }))
    }
  }

  const callStatus = async () => {
    try {
      const res = await fetch('/api/memory/status', { method: 'GET' })
      if (!res.ok) {
        const err = await res.json()
        throw err.error || 'Unknown error'
      }
      const data = await res.json()
      setTabsData(prev => ({
        ...prev,
        status: { ...prev.status, data, status: 'success' } as any,
      }))
    } catch (err: any) {
      setTabsData(prev => ({
        ...prev,
        status: { ...prev.status, status: 'error', error: err },
      }))
    }
  }

  const callHealth = async () => {
    try {
      const res = await fetch('/api/memory/health', { method: 'GET' })
      if (!res.ok) {
        const err = await res.json()
        throw err.error || 'Unknown error'
      }
      const data = await res.json()
      setTabsData(prev => ({
        ...prev,
        status: { ...prev.status, data, status: 'success' } as any,
      }))
    } catch (err: any) {
      setTabsData(prev => ({
        ...prev,
        status: { ...prev.status, status: 'error', error: err },
      }))
    }
  }

  const callReview = async () => {
    setTabsData(prev => ({ ...prev, review: { ...prev.review, status: 'loading' } }))
    try {
      const res = await fetch('/api/memory/review', { method: 'GET' })
      if (!res.ok) {
        const err = await res.json()
        throw err.error || 'Unknown error'
      }
      const data = await res.json()
      setTabsData(prev => ({ ...prev, review: { ...prev.review, data, status: 'success' } as TabData }))
    } catch (err: unknown) {
      setTabsData(prev => ({ ...prev, review: { ...prev.review, status: 'error', error: String(err) } }))
    }
  }

  const callReviewAction = async (action: 'demote' | 'mark_junk', id: number) => {
    setReviewActionStatus(prev => ({ ...prev, [id]: 'loading' }))
    try {
      const res = await fetch('/api/memory/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw err.error || 'Unknown error'
      }
      setReviewActionStatus(prev => ({ ...prev, [id]: action === 'mark_junk' ? 'junk' : 'demoted' }))
    } catch (err: unknown) {
      setReviewActionStatus(prev => ({ ...prev, [id]: `error: ${String(err)}` }))
    }
  }

  // Auto-refresh recall/audit when prompt changes
  useEffect(() => {
    if (prompt.trim()) {
      callRecall()
      callAudit()
    }
  }, [prompt, callAudit, callRecall])

  // Auto-refresh status
  useEffect(() => {
    callStatus()
  }, [])

  const reviewStatus = tabsData.review.status

  // Load review queue when switching to Review tab
  useEffect(() => {
    if (activeTab === 'review' && reviewStatus === 'idle') {
      callReview()
    }
  }, [activeTab, reviewStatus])

  const handleRecallSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    callRecall()
  }

  const handleAuditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    callAudit()
  }

  const handleOutcomeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (outcomeForm) {
      callOutcome(outcomeForm)
    }
  }

  const recallResult = tabsData.recall.data
  const auditResult = tabsData.audit.data
  const statusResult = tabsData.status.data
  const outcomeResult = tabsData.outcome.data

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Mission Control Memory
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage AI agent memory patterns, outcomes, and attribution signals
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                  ${
                    activeTab === tab.key
                      ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                {tab.label}
                <span className="ml-2 text-xs text-gray-400">({tab.description})</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {/* Recall Tab */}
          {activeTab === 'recall' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Recall Memories
              </h2>
              <form onSubmit={handleRecallSubmit} className="mb-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="recall-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Prompt
                    </label>
                    <input
                      type="text"
                      id="recall-prompt"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="e.g., timeout error, validate input"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="recall-limit" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Limit
                    </label>
                    <input
                      type="number"
                      id="recall-limit"
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      min={1}
                      max={20}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="recall-agent" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Agent
                    </label>
                    <input
                      type="text"
                      id="recall-agent"
                      value={agent}
                      onChange={(e) => setAgent(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="recall-run-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Run ID (optional)
                    </label>
                    <input
                      type="text"
                      id="recall-run-id"
                      value={runId}
                      onChange={(e) => setRunId(e.target.value)}
                      placeholder="e.g., run_001"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Recall Memories
                </button>
              </form>

              {/* Results */}
              {tabsData.recall.status !== 'idle' && (
                <div className="mt-6">
                  {tabsData.recall.status === 'loading' && (
                    <div className="text-center py-4">Loading...</div>
                  )}
                  {tabsData.recall.status === 'error' && (
                    <div className="text-red-600 dark:text-red-400 py-4">
                      Error: {tabsData.recall.error}
                    </div>
                  )}
                  {tabsData.recall.status === 'success' && recallResult && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Prompt: <span className="font-medium text-gray-900 dark:text-gray-100">{(recallResult as RecallResult).prompt || ''}</span>
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Used Patterns: <span className="font-medium text-gray-900 dark:text-gray-100">{(recallResult as RecallResult).usedPatterns?.join(', ') || 'none'}</span>
                          </p>
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          Found: {(recallResult as RecallResult).selected.length} memories
                          <span className="ml-4">Pruned: {(recallResult as RecallResult).pruned_count}</span>
                          <span className="ml-4">Merged: {(recallResult as RecallResult).merged_count}</span>
                        </div>
                      </div>
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                          <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Content Preview</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Score</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Promotion</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Explanation</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {(recallResult as RecallResult).selected.map((entry: MemoryEntry) => (
                              <tr key={entry.id}>
                                <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">
                                  {entry.content.length > 80
                                    ? entry.content.substring(0, 80) + '...'
                                    : entry.content}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.score.toFixed(3)}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.promotion_level}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.explanation || 'Ranked by score'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Audit Tab */}
          {activeTab === 'audit' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Audit Top Memories
              </h2>
              <form onSubmit={handleAuditSubmit} className="mb-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="audit-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Prompt
                    </label>
                    <input
                      type="text"
                      id="audit-prompt"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="e.g., timeout error, validate input"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="audit-limit" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Limit
                    </label>
                    <input
                      type="number"
                      id="audit-limit"
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      min={1}
                      max={50}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Audit Memories
                </button>
              </form>

              {/* Results */}
              {tabsData.audit.status !== 'idle' && (
                <div className="mt-6">
                  {tabsData.audit.status === 'loading' && (
                    <div className="text-center py-4">Loading...</div>
                  )}
                  {tabsData.audit.status === 'error' && (
                    <div className="text-red-600 dark:text-red-400 py-4">
                      Error: {tabsData.audit.error}
                    </div>
                  )}
                  {tabsData.audit.status === 'success' && auditResult && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Prompt: <span className="font-medium text-gray-900 dark:text-gray-100">{(auditResult as AuditResult).prompt || prompt}</span>
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Top Score: <span className="font-medium text-gray-900 dark:text-gray-100">{(auditResult as AuditResult).summary?.top_score?.toFixed(2)}</span>
                          </p>
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          Total Candidates: {(auditResult as AuditResult).summary?.total_candidates}
                          <span className="ml-4">Returned: {(auditResult as AuditResult).summary?.returned}</span>
                          <span className="ml-4">Warnings: {(auditResult as AuditResult).summary?.warning_count}</span>
                        </div>
                      </div>
                      {(auditResult as AuditResult).summary?.warnings.length > 0 && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                          <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium mb-2">Warnings:</p>
                          <ul className="list-disc list-inside text-sm text-yellow-800 dark:text-yellow-200">
                            {(auditResult as AuditResult).summary?.warnings.map((w, i) => (
                              <li key={i}>Entry {w.entryId}: {w.reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                          <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Content Preview</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Score</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Promotion</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Validation</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Causality</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Cluster</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Explanation</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {(auditResult as AuditResult).entries?.slice(0, 5).map((entry: AuditEntry) => (
                              <tr key={entry.id}>
                                <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">
                                  {entry.content}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.score?.toFixed(3)}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.promotion_level}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.validation_score > 0 ? '+' : ''}{entry.validation_score.toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.causality_score.toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                                  {entry.cluster_success_count}s / {entry.cluster_failure_count}f
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate">
                                  {entry.explanation || 'Ranked by score'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Outcome Tab */}
          {activeTab === 'outcome' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Mark Outcome
              </h2>
              <div className="mb-6">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Mark an outcome for a memory entry. This will update the signal tracking in the memory system.
                </p>
                <form onSubmit={handleOutcomeSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="outcome-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Memory ID
                      </label>
                      <input
                        type="number"
                        id="outcome-id"
                        value={outcomeForm?.id || ''}
                        onChange={(e) => updateOutcomeForm({ id: Number(e.target.value) })}
                        placeholder="Enter memory ID from recall results"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="outcome-outcome" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Outcome
                      </label>
                      <select
                        id="outcome-outcome"
                        value={outcomeForm?.outcome || 'success'}
                        onChange={(e) => updateOutcomeForm({ outcome: e.target.value as 'success' | 'failure' | 'unknown' })}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      >
                        <option value="success">success</option>
                        <option value="failure">failure</option>
                        <option value="unknown">unknown</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="outcome-usage" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Used Patterns (comma-separated IDs)
                      </label>
                      <input
                        type="text"
                        id="outcome-usage"
                        value={outcomeForm?.usedPatterns || ''}
                        onChange={(e) => updateOutcomeForm({ usedPatterns: e.target.value })}
                        placeholder="e.g., 1,2,3 or leave empty if this is the only pattern"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Leave empty if only marking this one pattern
                      </p>
                    </div>
                    <div>
                      <label htmlFor="outcome-primary" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Primary Pattern ID
                      </label>
                      <input
                        type="number"
                        id="outcome-primary"
                        value={outcomeForm?.primaryPatternId || ''}
                        onChange={(e) => updateOutcomeForm({ primaryPatternId: Number(e.target.value) })}
                        placeholder="The ID that 'won' this decision"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="outcome-run-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Run ID
                    </label>
                    <input
                      type="text"
                      id="outcome-run-id"
                      value={outcomeForm?.runId || ''}
                      onChange={(e) => updateOutcomeForm({ runId: e.target.value })}
                      placeholder="e.g., test_run_001"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    Mark Outcome
                  </button>
                </form>
              </div>
              {/* Results */}
              {tabsData.outcome.status !== 'idle' && (
                <div className="mt-6">
                  {tabsData.outcome.status === 'loading' && (
                    <div className="text-center py-4">Processing...</div>
                  )}
                  {tabsData.outcome.status === 'error' && (
                    <div className="text-red-600 dark:text-red-400 py-4">
                      Error: {tabsData.outcome.error}
                    </div>
                  )}
                  {tabsData.outcome.status === 'success' && outcomeResult && (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-4">
                      <p className="text-sm text-green-800 dark:text-green-200">
                        <strong>Success!</strong> Outcome marked for memory {(outcomeResult as any).id} as {(outcomeResult as any).outcome}
                      </p>
                      <p className="mt-2 text-xs text-green-700 dark:text-green-300">
                        Updated: {(outcomeResult as any).updated ? 'Yes' : 'No'}
                        {(outcomeResult as any).reason && ` (${(outcomeResult as any).reason})`}
                      </p>
                      {(outcomeResult as any).tags && (
                        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                          Tags: {(outcomeResult as any).tags}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Review Tab */}
          {activeTab === 'review' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    Review Queue
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Memories flagged for inspection — no changes applied until you act
                  </p>
                </div>
                <button
                  onClick={callReview}
                  className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  Refresh
                </button>
              </div>

              {tabsData.review.status === 'loading' && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">Scanning memories...</div>
              )}
              {tabsData.review.status === 'error' && (
                <div className="text-red-600 dark:text-red-400 py-4">Error: {tabsData.review.error}</div>
              )}

              {tabsData.review.status === 'success' && tabsData.review.data && (() => {
                const rv = tabsData.review.data as ReviewResult
                const visible = rv.entries.filter(e => !ignoredReviewIds.has(e.id))
                return (
                  <div className="space-y-5">
                    {/* Summary strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        { label: 'Total flagged', value: rv.summary.total_flagged, color: 'text-gray-900 dark:text-gray-100' },
                        { label: 'High risk',     value: rv.summary.high_risk,     color: 'text-red-700 dark:text-red-400' },
                        { label: 'Low validation',value: rv.summary.low_validation, color: 'text-orange-700 dark:text-orange-400' },
                        { label: 'Failure-heavy', value: rv.summary.failure_heavy,  color: 'text-red-700 dark:text-red-400' },
                        { label: 'Stale/unused',  value: rv.summary.stale_high_confidence, color: 'text-purple-700 dark:text-purple-400' },
                      ].map(s => (
                        <div key={s.label} className="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-center">
                          <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {visible.length === 0 && (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        {rv.entries.length === 0 ? 'No flagged entries — memory looks clean.' : 'All flagged entries ignored for this session.'}
                      </div>
                    )}

                    {/* Entry cards */}
                    <div className="space-y-3">
                      {visible.map(entry => {
                        const actionState = reviewActionStatus[entry.id]
                        const acted = actionState === 'junk' || actionState === 'demoted'
                        return (
                          <div
                            key={entry.id}
                            className={`rounded-lg border p-4 ${acted ? 'opacity-50 border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-700'}`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                {/* Warning badges */}
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {entry.warnings.map(w => {
                                    const meta = WARNING_META[w] || { label: w, color: 'bg-gray-100 text-gray-700' }
                                    return (
                                      <span key={w} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                                        {meta.label}
                                      </span>
                                    )
                                  })}
                                </div>

                                {/* Content preview */}
                                <p className="text-sm text-gray-900 dark:text-gray-100 font-mono leading-snug">
                                  {entry.content.length > 140 ? entry.content.slice(0, 140) + '…' : entry.content}
                                </p>

                                {/* Reason summary */}
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 italic">
                                  {entry.reason_summary}
                                </p>

                                {/* Metrics row */}
                                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                                  <span>id={entry.id}</span>
                                  <span>signal={entry.score}</span>
                                  <span>promo={entry.promotion_level}</span>
                                  <span>valid={entry.validation_score.toFixed(1)}</span>
                                  <span>{entry.cluster_success_count}s / {entry.cluster_failure_count}f / {entry.cluster_applied_count}applied</span>
                                </div>
                              </div>

                              {/* Action buttons */}
                              <div className="flex flex-col gap-1.5 shrink-0">
                                {acted ? (
                                  <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                                    {actionState === 'junk' ? 'Marked junk' : 'Demoted'}
                                  </span>
                                ) : actionState === 'loading' ? (
                                  <span className="text-xs text-gray-400">…</span>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => callReviewAction('mark_junk', entry.id)}
                                      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                                    >
                                      Mark Junk
                                    </button>
                                    <button
                                      onClick={() => callReviewAction('demote', entry.id)}
                                      className="rounded border border-orange-300 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/20"
                                    >
                                      Demote
                                    </button>
                                    <button
                                      onClick={() => setIgnoredReviewIds(prev => new Set([...prev, entry.id]))}
                                      className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                                    >
                                      Ignore
                                    </button>
                                  </>
                                )}
                                {typeof actionState === 'string' && actionState.startsWith('error:') && (
                                  <span className="text-xs text-red-500">{actionState}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Status Tab */}
          {activeTab === 'status' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Memory Status
              </h2>
              {tabsData.status.status !== 'idle' && (
                <div className="mt-6">
                  {tabsData.status.status === 'loading' && (
                    <div className="text-center py-4">Loading...</div>
                  )}
                  {tabsData.status.status === 'error' && (
                    <div className="text-red-600 dark:text-red-400 py-4">
                      Error: {tabsData.status.error}
                    </div>
                  )}
                  {tabsData.status.status === 'success' && statusResult && (
                    <div className="space-y-4">
                      <div className="border border-gray-200 dark:border-gray-700 rounded p-4 bg-gray-50 dark:bg-gray-700">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            Total Memories
                          </span>
                          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            {(statusResult as StatusResult).total_memories}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Source</h3>
                          <div className="space-y-1">
                            {(statusResult as StatusResult).by_source?.map((row: any) => (
                              <div key={row.source} className="text-sm text-gray-600 dark:text-gray-400">
                                {row.source}: <span className="font-medium">{row.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Category</h3>
                          <div className="space-y-1">
                            {(statusResult as StatusResult).by_category?.map((row: any) => (
                              <div key={row.category} className="text-sm text-gray-600 dark:text-gray-400">
                                {row.category}: <span className="font-medium">{row.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Outcome Counts</h3>
                          <div className="space-y-1">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              success: <span className="font-medium">{(statusResult as StatusResult).outcome_counts.success || 0}</span>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              failure: <span className="font-medium">{(statusResult as StatusResult).outcome_counts.failure || 0}</span>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              unknown: <span className="font-medium">{(statusResult as StatusResult).outcome_counts.unknown || 0}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Promotion Counts</h3>
                          <div className="space-y-1">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              core_rule: <span className="font-medium">{(statusResult as StatusResult).promoted_counts.core_rule || 0}</span>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              validated_pattern: <span className="font-medium">{(statusResult as StatusResult).promoted_counts.validated_pattern || 0}</span>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              candidate_pattern: <span className="font-medium">{(statusResult as StatusResult).promoted_counts.candidate_pattern || 0}</span>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              observation: <span className="font-medium">{(statusResult as StatusResult).promoted_counts.observation || 0}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {(statusResult as StatusResult).recent_count > 0 && (
                        <div>
                          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recent Memories</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {(statusResult as StatusResult).recent_count} recent memories stored
                          </p>
                        </div>
                      )}
                      {(statusResult as StatusResult).warnings.length > 0 && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                          <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium mb-2">Warnings:</p>
                          <ul className="list-disc list-inside text-sm text-yellow-800 dark:text-yellow-200">
                            {(statusResult as StatusResult).warnings.map((w: any, i: number) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
