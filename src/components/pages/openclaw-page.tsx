'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMissionControl, type CronJob, type MemoryFile } from '@/store'
import { Button } from '@/components/ui/button'

// ─── Types ───

interface SkillItem {
  id: string
  name: string
  source: string
  path: string
  description?: string
  enabled?: boolean
}

type SubTab = 'cron' | 'skills' | 'memory' | 'gateway'

// ─── OpenClawPage ───

export function OpenClawPage() {
  const { connection, cronJobs } = useMissionControl()
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('cron')

  const subTabs: { id: SubTab; label: string; badge?: string }[] = [
    { id: 'cron', label: 'Cron Jobs', badge: String(cronJobs.length) },
    { id: 'skills', label: 'Skills' },
    { id: 'memory', label: 'Memory Files' },
    { id: 'gateway', label: 'Gateway' },
  ]

  return (
    <div className="overflow-y-auto h-full">
      <div className="p-6 pb-0">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-heading text-xl font-semibold text-foreground">OpenClaw Integration</h2>
          <GatewayStatusBadge connection={connection} />
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Control surfaces for the OpenClaw runtime — cron jobs, skills, memory, and gateway health.
        </p>

        {/* Sub-tab switcher */}
        <div className="flex items-center gap-1 bg-secondary/60 rounded-full p-0.5 w-fit mb-6">
          {subTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`desk-tab text-xs px-4 py-1.5 ${activeSubTab === tab.id ? 'desk-tab-active' : ''}`}
            >
              {tab.label}
              {tab.badge && (
                <span className="ml-1.5 text-2xs opacity-70">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pb-6">
        {activeSubTab === 'cron' && <CronSection />}
        {activeSubTab === 'skills' && <SkillsSection />}
        {activeSubTab === 'memory' && <MemorySection />}
        {activeSubTab === 'gateway' && <GatewaySection />}
      </div>
    </div>
  )
}

// ─── Gateway Status Badge (header) ───

function GatewayStatusBadge({ connection }: { connection: { isConnected: boolean; latency?: number | null } }) {
  const isConnected = connection.isConnected
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
      isConnected
        ? 'bg-success/10 text-success border border-success/20'
        : 'bg-destructive/10 text-destructive border border-destructive/20'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-destructive animate-pulse'}`} />
      {isConnected
        ? `Connected${connection.latency != null ? ` · ${connection.latency}ms` : ''}`
        : 'Disconnected'
      }
    </div>
  )
}

// ═══════════════════════════════════════════
// CRON SECTION
// ═══════════════════════════════════════════

function CronSection() {
  const { cronJobs } = useMissionControl()
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; msg: string; type: 'success' | 'error' } | null>(null)

  const sortedJobs = useMemo(
    () => [...cronJobs].sort((a, b) => {
      // Enabled first, then by next run
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity)
    }),
    [cronJobs]
  )

  const cronAction = useCallback(async (action: string, jobId: string, jobName: string) => {
    setActionLoading(`${action}-${jobId || jobName}`)
    try {
      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobId, jobName }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed (${res.status})`)
      }
      setFeedback({ id: jobId || jobName, msg: `${action} successful`, type: 'success' })
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ id: jobId || jobName, msg: err?.message ?? 'Action failed', type: 'error' })
    } finally {
      setActionLoading(null)
    }
  }, [])

  if (sortedJobs.length === 0) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">No cron jobs configured.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Cron jobs will appear here once they&apos;re added via OpenClaw or the scheduler API.
        </p>
      </div>
    )
  }

  return (
    <div className="desk-panel overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/30">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Run</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Next Run</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {sortedJobs.map(job => {
            const jobKey = job.id || job.name
            const isLoading = actionLoading?.endsWith(jobKey)
            const jobFeedback = feedback?.id === jobKey ? feedback : null

            return (
              <tr key={jobKey} className={`hover:bg-secondary/30 transition-colors ${!job.enabled ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <p className="text-sm text-foreground font-medium truncate max-w-[240px]">{job.name}</p>
                  {job.agentId && (
                    <p className="text-2xs text-muted-foreground mt-0.5 font-mono-tight">{job.agentId}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground font-mono-tight">{job.schedule}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs ${
                    job.lastStatus === 'success' ? 'text-success' :
                    job.lastStatus === 'error' ? 'text-destructive' :
                    job.lastStatus === 'running' ? 'text-warning' :
                    'text-muted-foreground'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      job.lastStatus === 'success' ? 'bg-success' :
                      job.lastStatus === 'error' ? 'bg-destructive' :
                      job.lastStatus === 'running' ? 'bg-warning animate-pulse' :
                      'bg-muted-foreground/30'
                    }`} />
                    {job.enabled ? (job.lastStatus || 'idle') : 'disabled'}
                  </span>
                  {jobFeedback && (
                    <p className={`text-2xs mt-0.5 ${jobFeedback.type === 'success' ? 'text-success' : 'text-destructive'}`}>
                      {jobFeedback.msg}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {job.lastRun ? formatRelativeTime(job.lastRun * 1000) : '\u2014'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {job.nextRun ? formatRelativeTime(job.nextRun * 1000) : '\u2014'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-2xs h-7 px-2.5"
                      disabled={!!isLoading || !job.enabled}
                      onClick={() => cronAction('run', job.id || '', job.name)}
                    >
                      {isLoading && actionLoading?.startsWith('run') ? 'Running\u2026' : 'Run Now'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-2xs h-7 px-2.5"
                      disabled={!!isLoading}
                      onClick={() => cronAction('toggle', job.id || '', job.name)}
                    >
                      {job.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-2xs h-7 px-2.5 text-destructive hover:text-destructive"
                      disabled={!!isLoading}
                      onClick={() => {
                        if (confirm(`Delete cron job "${job.name}"?`)) {
                          cronAction('delete', job.id || '', job.name)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════
// SKILLS SECTION
// ═══════════════════════════════════════════

function SkillsSection() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/skills')
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = await res.json()
      setSkills(Array.isArray(data.skills) ? data.skills : Array.isArray(data) ? data : [])
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  if (loading) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">Loading skills\u2026</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchSkills}>Retry</Button>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">No skills found.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Skills are loaded from ~/.agents/skills, ~/.codex/skills, and ~/.openclaw/skills.
        </p>
      </div>
    )
  }

  // Group by source
  const grouped = skills.reduce<Record<string, SkillItem[]>>((acc, skill) => {
    const key = skill.source || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(skill)
    return acc
  }, {})

  const sourceLabels: Record<string, string> = {
    'user-agents': 'User Agent Skills',
    'user-codex': 'User Codex Skills',
    'project-agents': 'Project Agent Skills',
    'project-codex': 'Project Codex Skills',
    'openclaw': 'OpenClaw Skills',
    'workspace': 'Workspace Skills',
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([source, items]) => (
        <div key={source} className="desk-panel overflow-hidden">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">{sourceLabels[source] || source}</h3>
            <span className="text-2xs font-mono-tight text-muted-foreground">{items.length} skills</span>
          </div>
          <div className="divide-y divide-border/40">
            {items.map(skill => (
              <div key={skill.id} className="px-4 py-3 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground font-medium">{skill.name}</p>
                    {skill.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{skill.description}</p>
                    )}
                    <p className="text-2xs text-muted-foreground font-mono-tight mt-0.5 truncate">{skill.path}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════
// MEMORY SECTION
// ═══════════════════════════════════════════

function MemorySection() {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const fetchMemory = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/memory')
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = await res.json()
      setFiles(Array.isArray(data.files) ? data.files : Array.isArray(data) ? data : [])
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load memory files')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMemory() }, [fetchMemory])

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  if (loading) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">Loading memory files\u2026</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchMemory}>Retry</Button>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">No memory files found.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Memory files from the OpenClaw workspace will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="desk-panel overflow-hidden">
      <div className="panel-header">
        <h3 className="text-sm font-semibold text-foreground">Workspace Files</h3>
        <span className="text-2xs text-muted-foreground">Read-only</span>
      </div>
      <div className="panel-body p-0 max-h-[500px] overflow-y-auto">
        {files.map(file => (
          <MemoryFileRow
            key={file.path}
            file={file}
            depth={0}
            expandedPaths={expandedPaths}
            onToggle={toggleExpand}
          />
        ))}
      </div>
    </div>
  )
}

function MemoryFileRow({
  file,
  depth,
  expandedPaths,
  onToggle,
}: {
  file: MemoryFile
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
}) {
  const isDir = file.type === 'directory'
  const isExpanded = expandedPaths.has(file.path)
  const indent = depth * 16

  return (
    <>
      <button
        onClick={() => isDir && onToggle(file.path)}
        className={`w-full text-left px-4 py-2 hover:bg-secondary/30 transition-colors flex items-center gap-2 ${
          isDir ? 'cursor-pointer' : 'cursor-default'
        }`}
        style={{ paddingLeft: `${16 + indent}px` }}
      >
        {isDir ? (
          <svg
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 2h5l1 1h4v11H2V2h2z" />
          </svg>
        )}
        <span className={`text-xs truncate ${isDir ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
          {file.name}
        </span>
        {file.size != null && !isDir && (
          <span className="text-2xs text-muted-foreground/60 ml-auto shrink-0 font-mono-tight">
            {formatFileSize(file.size)}
          </span>
        )}
      </button>
      {isDir && isExpanded && file.children?.map(child => (
        <MemoryFileRow
          key={child.path}
          file={child}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

// ═══════════════════════════════════════════
// GATEWAY SECTION
// ═══════════════════════════════════════════

function GatewaySection() {
  const { connection, sessions, agents } = useMissionControl()

  const activeSessions = sessions.filter(s => s.active)
  const onlineAgents = agents.filter(a => a.status === 'idle' || a.status === 'busy')

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="desk-panel p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Connection Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GatewayMetricCard
            label="Status"
            value={connection.isConnected ? 'Connected' : 'Disconnected'}
            status={connection.isConnected ? 'success' : 'error'}
          />
          <GatewayMetricCard
            label="Latency"
            value={connection.latency != null ? `${connection.latency}ms` : '\u2014'}
            status={connection.latency != null && connection.latency < 100 ? 'success' : connection.latency != null ? 'warning' : 'muted'}
          />
          <GatewayMetricCard
            label="Active Sessions"
            value={String(activeSessions.length)}
            status={activeSessions.length > 0 ? 'info' : 'muted'}
          />
          <GatewayMetricCard
            label="Online Agents"
            value={`${onlineAgents.length}/${agents.length}`}
            status={onlineAgents.length > 0 ? 'success' : 'muted'}
          />
        </div>
      </div>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="desk-panel overflow-hidden">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Active Sessions</h3>
            <span className="text-2xs font-mono-tight text-muted-foreground">{activeSessions.length} active</span>
          </div>
          <div className="panel-body p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Session</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Model</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tokens</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {activeSessions.map(session => (
                  <tr key={session.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-2.5 text-xs font-mono-tight text-foreground">{session.key || session.id}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{session.agent || '\u2014'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{session.model || '\u2014'}</td>
                    <td className="px-4 py-2.5 text-xs font-mono-tight text-muted-foreground">{session.tokens || '\u2014'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{session.age || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Gateway Info */}
      <div className="desk-panel p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Gateway Endpoint</h3>
        <div className="space-y-2">
          <InfoRow label="WebSocket" value={`ws://localhost:18789`} />
          <InfoRow label="HTTP API" value={`http://localhost:18789`} />
          <InfoRow label="Auth" value="Gateway token (from .env)" />
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          This panel connects through the same WebSocket that powers the GW indicator in the OpsStrip.
          No separate browser tab needed.
        </p>
      </div>
    </div>
  )
}

function GatewayMetricCard({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: 'success' | 'warning' | 'error' | 'info' | 'muted'
}) {
  const colorClass =
    status === 'success' ? 'text-success' :
    status === 'warning' ? 'text-warning' :
    status === 'error' ? 'text-destructive' :
    status === 'info' ? 'text-info' :
    'text-muted-foreground'

  return (
    <div className="bg-secondary/50 rounded-xl p-3.5">
      <p className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-base font-semibold font-mono-tight ${colorClass}`}>{value}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <code className="text-foreground font-mono-tight bg-secondary/50 px-2 py-0.5 rounded">{value}</code>
    </div>
  )
}

// ─── Shared Helpers ───

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 0) {
    const absDiff = Math.abs(diff)
    if (absDiff < 60_000) return 'in <1m'
    if (absDiff < 3_600_000) return `in ${Math.floor(absDiff / 60_000)}m`
    if (absDiff < 86_400_000) return `in ${Math.floor(absDiff / 3_600_000)}h`
    return `in ${Math.floor(absDiff / 86_400_000)}d`
  }
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
