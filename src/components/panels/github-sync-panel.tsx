'use client'

import { useState, useEffect, useCallback } from 'react'

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

  // Feedback
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  // Check GitHub token status
  const checkToken = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', integrationId: 'github' }),
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
      })
      if (res.ok) {
        const data = await res.json()
        setSyncHistory(data.syncs || [])
      }
    } catch { /* ignore */ }
  }, [])

  // Fetch linked tasks
  const fetchLinkedTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?limit=200')
      if (res.ok) {
        const data = await res.json()
        const linked = (data.tasks || []).filter(
          (t: LinkedTask) => t.metadata?.github_repo
        )
        setLinkedTasks(linked)
      }
    } catch { /* ignore */ }
  }, [])

  // Fetch agents for assign dropdown
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      if (res.ok) {
        const data = await res.json()
        setAgents((data.agents || []).map((a: any) => ({ name: a.name })))
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    Promise.all([checkToken(), fetchSyncHistory(), fetchLinkedTasks(), fetchAgents()])
      .finally(() => setLoading(false))
  }, [checkToken, fetchSyncHistory, fetchLinkedTasks, fetchAgents])

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
      const res = await fetch(`/api/github?${params}`)
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

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading GitHub sync...</span>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">GitHub Issues Sync</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Import GitHub issues as Mission Control tasks
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
      <div className="rounded-xl border border-border bg-card overflow-hidden">
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
            <button
              onClick={handlePreview}
              disabled={previewing || !repo}
              className="px-4 py-1.5 text-xs rounded-md border border-border text-foreground hover:bg-secondary transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
            </button>
            <button
              onClick={handleImport}
              disabled={syncing || !repo}
              className={`px-4 py-1.5 text-xs rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                repo
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
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
            </button>
          </div>
        </div>
      </div>

      {/* Issue Preview Table */}
      {previewIssues.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
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
      {syncHistory.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">Sync History</h3>
          </div>
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
        </div>
      )}

      {/* Linked Tasks */}
      {linkedTasks.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">
              Linked Tasks ({linkedTasks.length})
            </h3>
          </div>
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
        </div>
      )}
    </div>
  )
}
