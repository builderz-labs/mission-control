'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { GitHubIssue, SyncRecord, LinkedTask, Project, SyncResult, TokenStatus, FeedbackState } from './github-sync-panel-types'
import { LoadingSpinner, ErrorBanner, FeedbackBanner, SyncResultBanner, ConnectionHeader, NotConfiguredNotice } from './github-sync-panel-status'
import { ImportIssuesForm } from './github-sync-panel-import-form'
import { TwoWaySyncSection } from './github-sync-panel-two-way-sync'
import { IssuePreviewTable } from './github-sync-panel-issue-preview'
import { SyncHistoryTable } from './github-sync-panel-sync-history'
import { LinkedTasksTable } from './github-sync-panel-linked-tasks'

// Alias matching the original export name used by the dynamic import in page.tsx
export { GithubSyncPanel as GitHubSyncPanel }

export function GithubSyncPanel(): React.JSX.Element {
  // Connection status
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null)

  // Import form
  const [repo, setRepo] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [assignAgent, setAssignAgent] = useState('')
  const [agents, setAgents] = useState<Array<{ name: string }>>([])

  // Preview
  const [previewIssues, setPreviewIssues] = useState<GitHubIssue[]>([])
  const [previewing, setPreviewing] = useState(false)

  // Sync
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)

  // Sync history + linked tasks
  const [syncHistory, setSyncHistory] = useState<SyncRecord[]>([])
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([])

  // Two-way sync
  const [projects, setProjects] = useState<Project[]>([])
  const [syncingProjectId, setSyncingProjectId] = useState<number | null>(null)

  // UI state
  const [feedback, setFeedback] = useState<FeedbackState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Timer ref prevents setState on unmounted component
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = (ok: boolean, text: string): void => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    setFeedback({ ok, text })
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 4000)
  }

  useEffect(() => {
    return () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current) }
  }, [])

  const checkToken = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', integrationId: 'github' }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json() as { ok?: boolean; detail?: string }
      setTokenStatus({ connected: data.ok === true, user: data.detail?.replace('User: ', '') })
    } catch {
      setTokenStatus({ connected: false })
    }
  }, [])

  const fetchSyncHistory = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json() as { syncs?: SyncRecord[] }
        setSyncHistory(data.syncs ?? [])
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  const fetchLinkedTasks = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/tasks?limit=200', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json() as { tasks?: LinkedTask[] }
        setLinkedTasks((data.tasks ?? []).filter((t) => t.metadata?.github_repo))
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  const fetchProjects = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/projects', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json() as { projects?: Project[] }
        setProjects(data.projects ?? [])
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  const fetchAgents = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/agents', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json() as { agents?: Array<{ name: string }> }
        setAgents((data.agents ?? []).map((a) => ({ name: a.name })))
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  const reloadAll = useCallback((): void => {
    setError(null)
    setLoading(true)
    void Promise.allSettled([checkToken(), fetchSyncHistory(), fetchLinkedTasks(), fetchAgents(), fetchProjects()])
      .finally(() => setLoading(false))
  }, [checkToken, fetchSyncHistory, fetchLinkedTasks, fetchAgents, fetchProjects])

  useEffect(() => { reloadAll() }, [reloadAll])

  const handlePreview = async (): Promise<void> => {
    if (!repo) { showFeedback(false, 'Enter a repository (owner/repo)'); return }
    setPreviewing(true)
    setPreviewIssues([])
    setSyncResult(null)
    try {
      const params = new URLSearchParams({ action: 'issues', repo, state: stateFilter })
      if (labelFilter) params.set('labels', labelFilter)
      const res = await fetch(`/api/github?${params}`, { signal: AbortSignal.timeout(8000) })
      const data = await res.json() as { issues?: GitHubIssue[]; error?: string }
      if (res.ok) {
        setPreviewIssues(data.issues ?? [])
        if (!data.issues?.length) showFeedback(true, 'No issues found matching filters')
      } else {
        showFeedback(false, data.error ?? 'Failed to fetch issues')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPreviewing(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    if (!repo) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', repo, labels: labelFilter || undefined, state: stateFilter, assignAgent: assignAgent || undefined }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json() as { imported?: number; skipped?: number; errors?: number; error?: string }
      if (res.ok) {
        const imported = data.imported ?? 0
        setSyncResult({ imported, skipped: data.skipped ?? 0, errors: data.errors ?? 0 })
        showFeedback(true, `Imported ${imported} issue${imported === 1 ? '' : 's'}, skipped ${data.skipped ?? 0}`)
        setPreviewIssues([])
        void fetchSyncHistory()
        void fetchLinkedTasks()
      } else {
        showFeedback(false, data.error ?? 'Sync failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSyncing(false)
    }
  }

  const handleToggleSync = async (project: Project): Promise<void> => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_sync_enabled: !project.github_sync_enabled }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        await fetchProjects()
        showFeedback(true, `Sync ${project.github_sync_enabled ? 'disabled' : 'enabled'} for ${project.name}`)
      } else {
        const data = await res.json() as { error?: string }
        showFeedback(false, data.error ?? 'Failed to toggle sync')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const handleSyncProject = async (projectId: number): Promise<void> => {
    setSyncingProjectId(projectId)
    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger', project_id: projectId }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json() as { message?: string; error?: string }
      if (res.ok) {
        showFeedback(true, data.message ?? 'Sync triggered')
        void fetchSyncHistory()
      } else {
        showFeedback(false, data.error ?? 'Sync failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSyncingProjectId(null)
    }
  }

  const handleSyncAll = async (): Promise<void> => {
    setSyncingProjectId(-1)
    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger-all' }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json() as { message?: string; error?: string }
      if (res.ok) {
        showFeedback(true, data.message ?? 'Sync triggered for all projects')
        void fetchSyncHistory()
      } else {
        showFeedback(false, data.error ?? 'Sync failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSyncingProjectId(null)
    }
  }

  if (loading) return <LoadingSpinner label="Loading GitHub sync..." />

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {error && <ErrorBanner message={error} onRetry={() => { setError(null); reloadAll() }} />}

      <ConnectionHeader tokenStatus={tokenStatus} />

      <NotConfiguredNotice tokenStatus={tokenStatus} />

      {feedback && <FeedbackBanner feedback={feedback} />}

      {syncResult && <SyncResultBanner result={syncResult} />}

      <ImportIssuesForm
        repo={repo}
        labelFilter={labelFilter}
        stateFilter={stateFilter}
        assignAgent={assignAgent}
        agents={agents}
        previewing={previewing}
        syncing={syncing}
        onRepoChange={setRepo}
        onLabelFilterChange={setLabelFilter}
        onStateFilterChange={setStateFilter}
        onAssignAgentChange={setAssignAgent}
        onPreview={() => { void handlePreview() }}
        onImport={() => { void handleImport() }}
      />

      <TwoWaySyncSection
        projects={projects}
        syncingProjectId={syncingProjectId}
        onToggleSync={(p) => { void handleToggleSync(p) }}
        onSyncProject={(id) => { void handleSyncProject(id) }}
        onSyncAll={() => { void handleSyncAll() }}
      />

      <IssuePreviewTable issues={previewIssues} />

      <SyncHistoryTable records={syncHistory} />

      <LinkedTasksTable tasks={linkedTasks} />
    </div>
  )
}
