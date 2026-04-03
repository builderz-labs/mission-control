'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'

interface GitHubLabel {
  name: string
  color?: string
}

interface GitHubIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: GitHubLabel[]
  assignee: { login: string } | null
  html_url: string
  created_at: string
  updated_at: string
}

interface SyncRecord {
  id: number
  repo: string
  last_synced_at: number
  issue_count: number
  sync_direction: string
  status: string
  error: string | null
  created_at: number
}

interface LinkedTask {
  id: number
  title: string
  status: string
  priority: string
  metadata: {
    github_repo?: string
    github_issue_number?: number
    github_issue_url?: string
    github_synced_at?: string
    github_state?: string
  }
}

export function GitHubSyncPanel() {
  // Connection status
  const [tokenStatus, setTokenStatus] = useState<{ connected: boolean; user?: string } | null>(null)

  // Import form
  const [repo, setRepo] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [assignAgent, setAssignAgent] = useState('')
  const [agents, setAgents] = useState<{ name: string }[]>([])

  // Preview
  const [previewIssues, setPreviewIssues] = useState<GitHubIssue[]>([])
  const [previewing, setPreviewing] = useState(false)

  // Sync
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null)

  // Sync history
  const [syncHistory, setSyncHistory] = useState<SyncRecord[]>([])

  // Linked tasks
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([])

  // Two-way sync
  const [projects, setProjects] = useState<Array<{
    id: number; name: string; github_repo?: string;
    github_sync_enabled?: boolean; github_labels_initialized?: boolean
  }>>([])
  const [syncingProjectId, setSyncingProjectId] = useState<number | null>(null)

  // Feedback
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Track timer so we can clear it on unmount (prevents setState on unmounted component)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = (ok: boolean, text: string) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    setFeedback({ ok, text })
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 4000)
  }

  useEffect(() => {
    return () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current) }
  }, [])

  // Check GitHub token status
  const checkToken = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', integrationId: 'github' }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      setTokenStatus({
        connected: data.ok === true,
        user: data.detail?.replace('User: ', ''),
      })
    } catch {
      setTokenStatus({ connected: false })
    }
  }, [])

  // Fetch sync history
  const fetchSyncHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        setSyncHistory(data.syncs || [])
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  // Fetch linked tasks
  const fetchLinkedTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?limit=200', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json()
        const linked = (data.tasks || []).filter(
          (t: LinkedTask) => t.metadata?.github_repo
        )
        setLinkedTasks(linked)
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  // Fetch projects for two-way sync
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  // Fetch agents for assign dropdown
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json()
        setAgents((data.agents || []).map((a: any) => ({ name: a.name })))
      }
    } catch {
      setError('Failed to load. Please try again.')
    }
  }, [])

  const reloadAll = useCallback(() => {
    setError(null)
    setLoading(true)
    Promise.allSettled([checkToken(), fetchSyncHistory(), fetchLinkedTasks(), fetchAgents(), fetchProjects()])
      .finally(() => setLoading(false))
  }, [checkToken, fetchSyncHistory, fetchLinkedTasks, fetchAgents, fetchProjects])

  useEffect(() => {
    reloadAll()
  }, [reloadAll])

  // Preview issues from GitHub
  const handlePreview = async () => {
    if (!repo) {
      showFeedback(false, 'Enter a repository (owner/repo)')
      return
    }
    setPreviewing(true)
    setPreviewIssues([])
    setSyncResult(null)
    try {
      const params = new URLSearchParams({ action: 'issues', repo, state: stateFilter })
      if (labelFilter) params.set('labels', labelFilter)
      const res = await fetch(`/api/github?${params}`, { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      if (res.ok) {
        setPreviewIssues(data.issues || [])
        if (data.issues?.length === 0) showFeedback(true, 'No issues found matching filters')
      } else {
        showFeedback(false, data.error || 'Failed to fetch issues')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPreviewing(false)
    }
  }

  // Import issues as tasks
  const handleImport = async () => {
    if (!repo) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync',
          repo,
          labels: labelFilter || undefined,
          state: stateFilter,
          assignAgent: assignAgent || undefined,
        }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        setSyncResult({ imported: data.imported, skipped: data.skipped, errors: data.errors })
        showFeedback(true, `Imported ${data.imported} issue${data.imported === 1 ? '' : 's'}, skipped ${data.skipped}`)
        setPreviewIssues([])
        fetchSyncHistory()
        fetchLinkedTasks()
      } else {
        showFeedback(false, data.error || 'Sync failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSyncing(false)
    }
  }

  // Two-way sync handlers
  const handleToggleSync = async (project: typeof projects[number]) => {
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
        const data = await res.json()
        showFeedback(false, data.error || 'Failed to toggle sync')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const handleSyncProject = async (projectId: number) => {
    setSyncingProjectId(projectId)
    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger', project_id: projectId }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, data.message || 'Sync triggered')
        fetchSyncHistory()
      } else {
        showFeedback(false, data.error || 'Sync failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSyncingProjectId(null)
    }
  }

  const handleSyncAll = async () => {
    setSyncingProjectId(-1)
    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger-all' }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, data.message || 'Sync triggered for all projects')
        fetchSyncHistory()
      } else {
        showFeedback(false, data.error || 'Sync failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSyncingProjectId(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 min-h-[200px]">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading GitHub sync...</span>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={() => { setError(null); reloadAll() }} className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300">Retry</button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">GitHub Issues Sync</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Import GitHub issues as Ultron tasks
          </p>
        </div>
        {/* Connection status badge */}
        <div className="flex items-center gap-2">
          <span className={`text-2xs px-2 py-1 rounded flex items-center gap-1.5 ${
            tokenStatus?.connected
              ? 'bg-green-500/10 text-green-400'
              : 'bg-destructive/10 text-destructive'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              tokenStatus?.connected ? 'bg-green-500' : 'bg-destructive'
            }`} />
            {tokenStatus?.connected
              ? `GitHub: ${tokenStatus.user || 'connected'}`
              : 'GitHub: not configured'}
          </span>
        </div>
      </div>

      {/* Not configured notice */}
      {tokenStatus && !tokenStatus.connected && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-400 text-lg mt-0.5">!</span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">GitHub token not configured</p>
              <p className="text-xs text-muted-foreground">
                Set <code className="px-1 py-0.5 rounded bg-secondary text-foreground font-mono text-2xs">GITHUB_TOKEN</code> in
                Integrations to enable issue sync. You can still browse sync history and linked tasks below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${
          feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Sync result banner */}
      {syncResult && (
        <div className="rounded-lg p-3 text-xs bg-blue-500/10 text-blue-400 flex items-center gap-4">
          <span>Imported: {syncResult.imported}</span>
          <span>Skipped: {syncResult.skipped}</span>
          {syncResult.errors > 0 && <span className="text-destructive">Errors: {syncResult.errors}</span>}
        </div>
      )}

      {/* Import Issues Form */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">Import Issues</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Repo input */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Repository</label>
              <input
                type="text"
                value={repo}
                onChange={e => setRepo(e.target.value)}
                placeholder="owner/repo"
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Label filter */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Labels (optional)</label>
              <input
                type="text"
                value={labelFilter}
                onChange={e => setLabelFilter(e.target.value)}
                placeholder="bug,enhancement"
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* State filter */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">State</label>
              <select
                value={stateFilter}
                onChange={e => setStateFilter(e.target.value as any)}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="all">All</option>
              </select>
            </div>

            {/* Assign to agent */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assign to Agent (optional)</label>
              <select
                value={assignAgent}
                onChange={e => setAssignAgent(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Unassigned</option>
                {agents.map(a => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={handlePreview}
              disabled={previewing || !repo}
              variant="outline"
              size="xs"
              className="flex items-center gap-1.5"
            >
              {previewing ? (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7" cy="7" r="5" />
                  <path d="M11 11l3 3" />
                </svg>
              )}
              Preview
            </Button>
            <Button
              onClick={handleImport}
              disabled={syncing || !repo}
              size="xs"
              className={`flex items-center gap-1.5 ${
                !repo ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''
              }`}
            >
              {syncing ? (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v8M5 7l3 3 3-3" />
                  <path d="M3 12v2h10v-2" />
                </svg>
              )}
              Import
            </Button>
          </div>
        </div>
      </div>

      {/* Two-Way Sync */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Two-Way Sync</h3>
          <Button
            variant="outline"
            size="xs"
            onClick={handleSyncAll}
            disabled={syncingProjectId !== null}
            className="flex items-center gap-1.5"
          >
            Sync All
          </Button>
        </div>
        <div className="divide-y divide-border/50">
          {projects.filter(p => p.github_repo).map(project => (
            <div key={project.id} className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${project.github_sync_enabled ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                <div>
                  <div className="text-sm text-foreground">{project.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{project.github_repo}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleToggleSync(project)}
                  className="text-xs"
                >
                  {project.github_sync_enabled ? 'Disable' : 'Enable'}
                </Button>
                {project.github_sync_enabled && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleSyncProject(project.id)}
                    disabled={syncingProjectId === project.id}
                    className="flex items-center gap-1.5"
                  >
                    {syncingProjectId === project.id ? (
                      <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 8a6 6 0 0110.472-4M14 8a6 6 0 01-10.472 4" />
                        <path d="M13 2v4h-4M3 14v-4h4" />
                      </svg>
                    )}
                    Sync
                  </Button>
                )}
              </div>
            </div>
          ))}
          {projects.filter(p => p.github_repo).length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No projects linked to GitHub repos. Set a GitHub repo in Project Management.
            </div>
          )}
        </div>
      </div>

      {/* Issue Preview Table */}
      {previewIssues.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">
              Preview ({previewIssues.length} issues)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">#</th>
                  <th className="text-left px-4 py-2 font-medium">Title</th>
                  <th className="text-left px-4 py-2 font-medium">Labels</th>
                  <th className="text-left px-4 py-2 font-medium">State</th>
                  <th className="text-left px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {previewIssues.map(issue => (
                  <tr key={issue.number} className="border-b border-border/50 hover:bg-secondary/50">
                    <td className="px-4 py-2 text-muted-foreground">{issue.number}</td>
                    <td className="px-4 py-2 text-foreground max-w-[300px] truncate">
                      <a
                        href={issue.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary transition-colors"
                      >
                        {issue.title}
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {issue.labels.map(l => (
                          <span
                            key={l.name}
                            className="px-1.5 py-0.5 rounded text-2xs bg-secondary text-muted-foreground"
                          >
                            {l.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-2xs ${
                        issue.state === 'open'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-purple-500/10 text-purple-400'
                      }`}>
                        {issue.state}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(issue.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sync History */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">Sync History</h3>
        </div>
        {syncHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Repo</th>
                  <th className="text-left px-4 py-2 font-medium">Issues</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Synced At</th>
                </tr>
              </thead>
              <tbody>
                {syncHistory.map(sync => (
                  <tr key={sync.id} className="border-b border-border/50 hover:bg-secondary/50">
                    <td className="px-4 py-2 font-mono text-foreground">{sync.repo}</td>
                    <td className="px-4 py-2 text-muted-foreground">{sync.issue_count}</td>
                    <td className="px-4 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-2xs ${
                        sync.status === 'success'
                          ? 'bg-green-500/10 text-green-400'
                          : sync.status === 'partial'
                          ? 'bg-yellow-500/10 text-yellow-400'
                          : 'bg-destructive/10 text-destructive'
                      }`}>
                        {sync.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(sync.created_at * 1000).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No sync history yet. Import issues above to get started.
          </div>
        )}
      </div>

      {/* Linked Tasks */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">
            Linked Tasks{linkedTasks.length > 0 ? ` (${linkedTasks.length})` : ''}
          </h3>
        </div>
        {linkedTasks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Task</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Priority</th>
                  <th className="text-left px-4 py-2 font-medium">GitHub</th>
                  <th className="text-left px-4 py-2 font-medium">Synced</th>
                </tr>
              </thead>
              <tbody>
                {linkedTasks.map(task => (
                  <tr key={task.id} className="border-b border-border/50 hover:bg-secondary/50">
                    <td className="px-4 py-2 text-foreground max-w-[250px] truncate">{task.title}</td>
                    <td className="px-4 py-2">
                      <span className="px-1.5 py-0.5 rounded text-2xs bg-secondary text-muted-foreground">
                        {task.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-2xs ${
                        task.priority === 'critical' ? 'bg-red-500/10 text-red-400' :
                        task.priority === 'high' ? 'bg-orange-500/10 text-orange-400' :
                        task.priority === 'low' ? 'bg-blue-500/10 text-blue-400' :
                        'bg-secondary text-muted-foreground'
                      }`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {task.metadata.github_issue_url ? (
                        <a
                          href={task.metadata.github_issue_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline font-mono"
                        >
                          {task.metadata.github_repo}#{task.metadata.github_issue_number}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {task.metadata.github_synced_at
                        ? new Date(task.metadata.github_synced_at).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No tasks linked to GitHub issues yet.
          </div>
        )}
      </div>
    </div>
  )
}
