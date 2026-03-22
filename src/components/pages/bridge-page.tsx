'use client'

import { useState, useMemo } from 'react'
import { useMissionControl, type Agent, type Activity, type CronJob } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import {
  getAgentIdentity,
  isAgentStale,
  isAgentHidden,
  getFreshnessLabel,
  TIER_META,
  OPERATION_SCHEDULES,
  type FleetTier,
  type OperationSchedule,
} from '@/lib/agent-identity'
import { Button } from '@/components/ui/button'

/**
 * BridgePage — Operator's briefing board.
 *
 * Fleet tiers:
 *   Operator  — JARVIS main (OpenClaw). Pinned hero card.
 *   Primary   — Twin agents at build.twin.so. The workhorses.
 *   Dev Tools — Local Claude Code sub-agents. Collapsed by default.
 *   External  — Perplexity Computer, etc. Static cards, no live heartbeat.
 *   Hidden    — dispatch_twin, dogfood. Not shown.
 *
 * Layout:
 *   Left (flex-1):
 *     - Operator hero card
 *     - Primary Fleet grid (sorted by relevance)
 *     - Dev Tools (collapsible)
 *     - Schedules table
 *   Right (w-80):
 *     - Briefing strip
 */
export function BridgePage() {
  const { agents, activities, tasks, cronJobs, sessions, connection } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [devToolsOpen, setDevToolsOpen] = useState(false)

  // Group agents by fleet tier, excluding hidden
  const fleetGroups = useMemo(() => {
    const groups: Record<FleetTier, Agent[]> = {
      operator: [],
      primary: [],
      external: [],
      devtools: [],
      hidden: [],
    }

    for (const agent of agents) {
      if (isAgentHidden(agent.name)) continue
      const identity = getAgentIdentity(agent.name)
      groups[identity.tier].push(agent)
    }

    // Sort primary by relevance: active work first, stale to bottom
    const sortByRelevance = (list: Agent[]) =>
      [...list].sort((a, b) => {
        const aReview = (a.taskStats?.quality_review ?? 0) + (a.taskStats?.in_progress ?? 0)
        const bReview = (b.taskStats?.quality_review ?? 0) + (b.taskStats?.in_progress ?? 0)
        if (aReview !== bReview) return bReview - aReview
        const aTime = a.last_seen ?? a.updated_at ?? 0
        const bTime = b.last_seen ?? b.updated_at ?? 0
        if (aTime !== bTime) return bTime - aTime
        if (a.last_seen && !b.last_seen) return -1
        if (!a.last_seen && b.last_seen) return 1
        return 0
      })

    groups.primary = sortByRelevance(groups.primary)
    groups.devtools = sortByRelevance(groups.devtools)

    return groups
  }, [agents])

  // Briefing sidebar: operational events that matter
  const briefingEvents = useMemo(
    () => [...activities]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 15),
    [activities]
  )

  // Items needing attention
  const needsAttention = useMemo(
    () => tasks.filter(t => t.status === 'review' || t.status === 'quality_review'),
    [tasks]
  )

  // Next scheduled runs
  const upcomingSchedules = useMemo(
    () => cronJobs
      .filter(c => c.enabled && c.nextRun)
      .sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity))
      .slice(0, 5),
    [cronJobs]
  )

  // Schedules table (all enabled)
  const allSchedules = useMemo(
    () => cronJobs.filter(c => c.enabled).sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity)),
    [cronJobs]
  )

  const totalVisible = fleetGroups.operator.length + fleetGroups.primary.length + fleetGroups.external.length + fleetGroups.devtools.length + 1 /* Perplexity Computer static */

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Summary line */}
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            {totalVisible} agents reporting
            {fleetGroups.primary.length > 0 && (
              <span> · <span className="text-primary font-medium">{fleetGroups.primary.length} in primary fleet</span></span>
            )}
            {needsAttention.length > 0 && (
              <span> · <span className="text-primary font-medium">{needsAttention.length} items need you</span></span>
            )}
          </p>
        </div>

        {totalVisible === 0 ? (
          <div className="desk-panel p-8 text-center">
            <p className="text-base text-foreground font-medium mb-2">No agents connected yet</p>
            <p className="text-sm text-muted-foreground">
              Agents will appear here once they connect to the gateway.
              Each one will report what they do, what they&apos;ve done, and what you can ask them.
            </p>
          </div>
        ) : (
          <>
            {/* ═══ OPERATOR — JARVIS Hero Card ═══ */}
            {fleetGroups.operator.length > 0 && (
              <div className="mb-8">
                {fleetGroups.operator.map(agent => (
                  <OperatorHeroCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                    isSelected={selectedAgent?.id === agent.id}
                    onQuickAction={(target) => navigateToPanel(target)}
                    connectionStatus={connection}
                  />
                ))}
              </div>
            )}

            {/* ═══ PRIMARY FLEET — Twin Agents ═══ */}
            {fleetGroups.primary.length > 0 && (
              <div className="mb-8">
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="font-heading text-lg font-semibold text-foreground">
                    {TIER_META.primary.label}
                  </h2>
                  <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                    {TIER_META.primary.description}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {fleetGroups.primary.map(agent => (
                    <AgentBriefingCard
                      key={agent.id}
                      agent={agent}
                      onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                      isSelected={selectedAgent?.id === agent.id}
                      onQuickAction={(target) => {
                        if (target.startsWith('http')) {
                          window.open(target, '_blank', 'noopener')
                        } else {
                          navigateToPanel(target)
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ═══ EXTERNAL INTELLIGENCE — Perplexity Computer, etc. ═══ */}
            <div className="mb-8">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="font-heading text-lg font-semibold text-foreground">
                  {TIER_META.external.label}
                </h2>
                <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {TIER_META.external.description}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {/* Static Perplexity Computer card */}
                <PerplexityComputerCard />
                {/* Any external-tier agents from the store */}
                {fleetGroups.external.map(agent => (
                  <AgentBriefingCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                    isSelected={selectedAgent?.id === agent.id}
                    onQuickAction={(target) => {
                      if (target.startsWith('http')) {
                        window.open(target, '_blank', 'noopener')
                      } else {
                        navigateToPanel(target)
                      }
                    }}
                  />
                ))}
              </div>
            </div>

            {/* ═══ DEV TOOLS — Local Claude Code Agents ═══ */}
            {fleetGroups.devtools.length > 0 && (
              <div className="mb-8">
                <button
                  onClick={() => setDevToolsOpen(!devToolsOpen)}
                  className="mb-3 flex items-center gap-2 group"
                >
                  <svg
                    className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${devToolsOpen ? 'rotate-90' : ''}`}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                  <h2 className="font-heading text-base font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                    {TIER_META.devtools.label}
                  </h2>
                  <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                    {fleetGroups.devtools.length} agents · {TIER_META.devtools.description}
                  </span>
                </button>

                {devToolsOpen && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {fleetGroups.devtools.map(agent => (
                      <AgentBriefingCard
                        key={agent.id}
                        agent={agent}
                        onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                        isSelected={selectedAgent?.id === agent.id}
                        onQuickAction={(target) => navigateToPanel(target)}
                        isSecondary
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Schedules Table — Full Operation Surface */}
        <div className="mb-8">
          <h2 className="font-heading text-lg font-semibold text-foreground mb-3">Full Operation Schedule</h2>
          <p className="text-xs text-muted-foreground mb-3">Everything that runs automatically — JARVIS agents, external platforms, and infrastructure crons.</p>
          <div className="desk-panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">When</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Days</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">What Happens</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {/* Static operation schedules */}
                {OPERATION_SCHEDULES.map((sched, i) => (
                  <OperationScheduleRow key={`static-${i}`} schedule={sched} />
                ))}
                {/* Dynamic cron jobs from the store */}
                {allSchedules.map(cron => (
                  <ScheduleTableRow key={cron.id || cron.name} cron={cron} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Briefing Sidebar */}
      <aside className="hidden lg:flex w-80 h-full border-l border-border bg-card flex-col shrink-0">
        {/* What Needs You */}
        {needsAttention.length > 0 && (
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">
              Needs Your Attention
            </h3>
            <div className="space-y-2">
              {needsAttention.slice(0, 5).map(task => (
                <button
                  key={task.id}
                  onClick={() => navigateToPanel('tasks')}
                  className="w-full text-left p-2 rounded-lg bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  <p className="text-xs text-foreground font-medium truncate">{task.title}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5">
                    {task.assigned_to ? `From ${task.assigned_to}` : 'Unassigned'} · {task.status === 'quality_review' ? 'QA Review' : 'Review'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Next Up */}
        {upcomingSchedules.length > 0 && (
          <div className="px-4 pt-3 pb-3 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Next Up
            </h3>
            <div className="space-y-1.5">
              {upcomingSchedules.map(cron => (
                <div key={cron.id || cron.name} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground font-mono-tight shrink-0">
                    {cron.nextRun ? formatFutureTime(cron.nextRun * 1000) : '\u2014'}
                  </span>
                  <span className="text-foreground truncate">{cron.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Briefing Feed */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-3 pb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What Happened</h3>
          </div>
          <div className="divide-y divide-border/40">
            {briefingEvents.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">No activity yet.</p>
                <p className="text-2xs text-muted-foreground mt-1">
                  Events will appear here as your agents complete work.
                </p>
              </div>
            ) : (
              briefingEvents.map(act => (
                <BriefingRow key={act.id} activity={act} />
              ))
            )}
          </div>
        </div>

        {/* Connection — minimal ambient signal */}
        <div className="border-t border-border px-4 py-2.5 shrink-0 flex items-center justify-between text-2xs text-muted-foreground">
          <span>Gateway</span>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${connection.isConnected ? 'bg-success' : 'bg-destructive animate-pulse'}`} />
            <span>{connection.isConnected ? (connection.latency != null ? `${connection.latency}ms` : 'connected') : 'disconnected'}</span>
          </div>
        </div>
      </aside>

      {/* Agent Detail Overlay */}
      {selectedAgent && (
        <AgentDetailOverlay
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onNavigate={navigateToPanel}
        />
      )}
    </div>
  )
}

// ─── Operator Hero Card ───
// JARVIS main gets a wider, more prominent card at the top

function OperatorHeroCard({
  agent,
  onClick,
  isSelected,
  onQuickAction,
  connectionStatus,
}: {
  agent: Agent
  onClick: () => void
  isSelected: boolean
  onQuickAction: (target: string) => void
  connectionStatus: { isConnected: boolean; latency?: number | null }
}) {
  const identity = getAgentIdentity(agent.name)
  const freshness = getFreshnessLabel(agent.last_seen)

  return (
    <div
      className={`desk-panel border-l-4 border-l-primary transition-all duration-200 hover:shadow-lg ${
        isSelected ? 'ring-2 ring-primary/40' : ''
      }`}
    >
      <button onClick={onClick} className="w-full text-left p-5 pb-0">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{identity.icon}</span>
            <div>
              <h2 className="text-base font-heading font-semibold text-foreground">{identity.roleTitle}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {identity.runtime || 'Mac Mini'}
                <span className="mx-1.5">&middot;</span>
                <span className={connectionStatus.isConnected ? 'text-success' : 'text-destructive'}>
                  {connectionStatus.isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </p>
            </div>
          </div>
          <span
            className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
              connectionStatus.isConnected ? 'bg-success' : 'bg-destructive animate-pulse'
            }`}
          />
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mt-3">
          {identity.oneLiner}
        </p>
      </button>

      <div className="px-5 pt-3 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 px-3 bg-transparent hover:bg-primary/5 text-primary border-primary/30 hover:border-primary/50"
            onClick={(e) => {
              e.stopPropagation()
              onQuickAction(identity.quickActionTarget)
            }}
          >
            {identity.quickAction}
          </Button>
          {agent.last_activity && (
            <span className="text-2xs text-muted-foreground">{freshness}</span>
          )}
        </div>
        <span className="text-2xs text-muted-foreground font-mono-tight">{agent.name}</span>
      </div>
    </div>
  )
}

// ─── Agent Briefing Card ───
// Answers: 1) What's your job? 2) What did you do for me? 3) What can I do with you?

function AgentBriefingCard({
  agent,
  onClick,
  isSelected,
  onQuickAction,
  isSecondary = false,
}: {
  agent: Agent
  onClick: () => void
  isSelected: boolean
  onQuickAction: (target: string) => void
  isSecondary?: boolean
}) {
  const identity = getAgentIdentity(agent.name)
  const stale = isAgentStale(agent.last_seen)
  const freshness = getFreshnessLabel(agent.last_seen)

  // Primary fleet gets terracotta accent, devtools get sage
  const accentClass = isSecondary
    ? (stale ? 'border-l-4 border-l-border' : 'border-l-4 border-l-success/60')
    : (stale ? 'border-l-4 border-l-border' : 'border-l-4 border-l-primary')

  return (
    <div
      className={`desk-panel ${accentClass} transition-all duration-200 hover:shadow-lg ${
        isSelected ? 'ring-2 ring-primary/40' : ''
      } ${isSecondary ? 'opacity-80' : ''}`}
    >
      {/* Header: Role title + ambient health dot + runtime badge */}
      <button onClick={onClick} className="w-full text-left p-4 pb-0">
        <div className="flex items-start justify-between mb-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-base">{identity.icon}</span>
              <h3 className="text-sm font-semibold text-foreground truncate">{identity.roleTitle}</h3>
            </div>
            {identity.runtime && (
              <p className="text-2xs text-muted-foreground mt-0.5 ml-7">{identity.runtime}</p>
            )}
          </div>
          {/* Tiny ambient health dot */}
          <span
            className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${
              agent.status === 'error' ? 'bg-destructive' :
              agent.status === 'busy' ? 'bg-warning pulse-dot' :
              agent.status === 'idle' ? 'bg-success' :
              'bg-muted-foreground/30'
            }`}
            title={agent.status}
          />
        </div>

        {/* Q1: What's your job? */}
        <p className="text-xs text-muted-foreground leading-relaxed mt-1 line-clamp-2">
          {identity.oneLiner}
        </p>
      </button>

      {/* Q2: What did you do for me lately? */}
      <div className="px-4 pt-3">
        {agent.last_activity ? (
          <div className="text-xs leading-relaxed">
            <p className="text-foreground line-clamp-3">{agent.last_activity}</p>
            <p className="text-2xs text-muted-foreground mt-1">{freshness}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No runs yet</p>
        )}
      </div>

      {/* Capability tags */}
      {identity.capabilities.length > 0 && (
        <div className="px-4 pt-2.5 flex flex-wrap gap-1.5">
          {identity.capabilities.slice(0, 4).map(cap => (
            <span
              key={cap}
              className="text-2xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border/50"
            >
              {cap}
            </span>
          ))}
        </div>
      )}

      {/* Q3: What can I do with you right now? */}
      {identity.quickAction && (
        <div className="px-4 pt-3 pb-4">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-3 bg-transparent hover:bg-primary/5 text-primary border-primary/30 hover:border-primary/50"
              onClick={(e) => {
                e.stopPropagation()
                onQuickAction(identity.quickActionTarget)
              }}
            >
              {identity.quickAction}
            </Button>
            <span className="text-2xs text-muted-foreground font-mono-tight">{agent.name}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Agent Detail Overlay ───

function AgentDetailOverlay({
  agent,
  onClose,
  onNavigate,
}: {
  agent: Agent
  onClose: () => void
  onNavigate: (panel: string) => void
}) {
  const identity = getAgentIdentity(agent.name)
  const freshness = getFreshnessLabel(agent.last_seen)
  const stats = agent.taskStats

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-foreground/5 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-card border-l border-border shadow-2xl slide-in-right overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{identity.icon}</span>
            <div>
              <h2 className="text-base font-semibold text-foreground">{identity.roleTitle}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-2xs text-muted-foreground font-mono-tight">{agent.name}</p>
                {identity.runtime && (
                  <>
                    <span className="text-2xs text-muted-foreground">&middot;</span>
                    <p className="text-2xs text-muted-foreground">{identity.runtime}</p>
                  </>
                )}
                <span className={`text-2xs px-1.5 py-0 rounded ${
                  identity.tier === 'primary' ? 'bg-primary/10 text-primary' :
                  identity.tier === 'operator' ? 'bg-primary/10 text-primary' :
                  'bg-secondary text-muted-foreground'
                }`}>
                  {TIER_META[identity.tier].label}
                </span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        </div>

        <div className="p-5 space-y-6">
          {/* What's their job */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">What They Do</h3>
            <p className="text-sm text-foreground leading-relaxed">{identity.oneLiner}</p>
          </div>

          {/* Capabilities */}
          {identity.capabilities.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Capabilities</h3>
              <div className="flex flex-wrap gap-2">
                {identity.capabilities.map(cap => (
                  <span key={cap} className="text-xs px-2.5 py-1 rounded-full bg-secondary text-foreground border border-border/50">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* What did they do */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Last Report</h3>
            {agent.last_activity ? (
              <div>
                <p className="text-sm text-foreground leading-relaxed">{agent.last_activity}</p>
                <p className="text-xs text-muted-foreground mt-2">{freshness}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No activity recorded yet. This agent is awaiting its first assignment.</p>
            )}
          </div>

          {/* Task summary — if they have tasks */}
          {stats && stats.total > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Task Summary</h3>
              <div className="grid grid-cols-3 gap-3">
                <StatBox label="Active" value={(stats.assigned ?? 0) + (stats.in_progress ?? 0)} />
                <StatBox label="In Review" value={stats.quality_review ?? 0} />
                <StatBox label="Completed" value={stats.done ?? 0} />
              </div>
            </div>
          )}

          {/* Soul / Working Memory — for power users */}
          {agent.soul_content && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Agent Soul</h3>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{agent.soul_content}</p>
            </div>
          )}

          {/* Quick action */}
          {identity.quickAction && (
            <div className="pt-2">
              <Button
                className="w-full"
                onClick={() => {
                  if (identity.quickActionTarget.startsWith('http')) {
                    window.open(identity.quickActionTarget, '_blank', 'noopener')
                  } else {
                    onNavigate(identity.quickActionTarget)
                  }
                  onClose()
                }}
              >
                {identity.quickAction}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Schedule Table Row ───

function ScheduleTableRow({ cron }: { cron: CronJob }) {
  const nextStr = cron.nextRun ? formatScheduleTime(cron.nextRun * 1000) : '\u2014'
  const lastStr = cron.lastRun ? formatRelativeTime(cron.lastRun * 1000) : 'Never'

  const statusDot =
    cron.lastStatus === 'success' ? 'bg-success' :
    cron.lastStatus === 'error' ? 'bg-destructive' :
    cron.lastStatus === 'running' ? 'bg-warning pulse-dot' :
    'bg-muted-foreground/30'

  return (
    <tr className="hover:bg-secondary/30 transition-colors">
      <td className="px-4 py-2.5 text-xs font-mono-tight text-foreground whitespace-nowrap">{nextStr}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">{lastStr || '\u2014'}</td>
      <td className="px-4 py-2.5 text-xs text-foreground">{cron.name}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">\u2014</td>
      <td className="px-4 py-2.5">
        <span className="text-2xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border/50">
          MC Cron
        </span>
      </td>
    </tr>
  )
}

// \u2500\u2500\u2500 Operation Schedule Row (static entries) \u2500\u2500\u2500

function OperationScheduleRow({ schedule }: { schedule: OperationSchedule }) {
  const sourceLabel =
    schedule.source === 'external' ? 'External' :
    schedule.source === 'twin' ? 'Twin Agent' :
    schedule.source === 'openclaw' ? 'OpenClaw' :
    'jarvisv2'

  const sourceBg =
    schedule.source === 'external' ? 'bg-primary/10 text-primary' :
    schedule.source === 'twin' ? 'bg-success/10 text-success' :
    schedule.source === 'openclaw' ? 'bg-warning/10 text-warning' :
    'bg-secondary text-muted-foreground'

  return (
    <tr className="hover:bg-secondary/30 transition-colors">
      <td className="px-4 py-2.5 text-xs font-mono-tight text-foreground whitespace-nowrap">{schedule.time}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">{schedule.days}</td>
      <td className="px-4 py-2.5 text-xs text-foreground">{schedule.description}</td>
      <td className="px-4 py-2.5 text-xs text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span>{schedule.icon}</span>
          {schedule.agent}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-2xs px-2 py-0.5 rounded-full border border-border/50 ${sourceBg}`}>
          {sourceLabel}{schedule.isStatic ? '' : ' \u00b7 Live'}
        </span>
      </td>
    </tr>
  )
}

// \u2500\u2500\u2500 Perplexity Computer Static Card \u2500\u2500\u2500

function PerplexityComputerCard() {
  const identity = getAgentIdentity('perplexity-computer')

  return (
    <div className="desk-panel border-l-4 border-l-primary transition-all duration-200 hover:shadow-lg">
      <div className="p-4 pb-0">
        <div className="flex items-start justify-between mb-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-base">{identity.icon}</span>
              <h3 className="text-sm font-semibold text-foreground truncate">{identity.roleTitle}</h3>
            </div>
            <p className="text-2xs text-muted-foreground mt-0.5 ml-7">{identity.runtime}</p>
          </div>
          {/* Static indicator \u2014 no live heartbeat */}
          <span className="text-2xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground" title="Static entry \u2014 no live heartbeat">
            Static
          </span>
        </div>

        {/* What\u2019s your job? */}
        <p className="text-xs text-muted-foreground leading-relaxed mt-1 line-clamp-2">
          {identity.oneLiner}
        </p>
      </div>

      {/* Schedule */}
      <div className="px-4 pt-3">
        <div className="text-xs leading-relaxed">
          <p className="text-foreground">\u23f0 7:15 AM CT Mon\u2013Fri \u2014 Morning brief + Gmail drafts</p>
          <p className="text-foreground mt-0.5">\u23f0 2:00 PM CT Mon\u2013Fri \u2014 Afternoon email scan + drafts</p>
        </div>
      </div>

      {/* Capability tags */}
      <div className="px-4 pt-2.5 flex flex-wrap gap-1.5">
        {identity.capabilities.map(cap => (
          <span
            key={cap}
            className="text-2xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border/50"
          >
            {cap}
          </span>
        ))}
      </div>

      {/* Quick action \u2014 external link */}
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 px-3 bg-transparent hover:bg-primary/5 text-primary border-primary/30 hover:border-primary/50"
            onClick={() => window.open('https://www.perplexity.ai', '_blank', 'noopener')}
          >
            {identity.quickAction}
          </Button>
          <span className="text-2xs text-muted-foreground italic">External platform</span>
        </div>
      </div>
    </div>
  )
}

// ─── Briefing Sidebar Row ───

function BriefingRow({ activity }: { activity: Activity }) {
  const timeStr = formatRelativeTime(activity.created_at * 1000)
  return (
    <div className="px-4 py-2.5 hover:bg-secondary/30 transition-colors">
      <p className="text-xs text-foreground leading-relaxed line-clamp-2">{activity.description}</p>
      <p className="text-2xs text-muted-foreground mt-1">{timeStr}</p>
    </div>
  )
}

// ─── Shared Primitives ───

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-secondary/50 rounded-lg p-2.5 text-center">
      <div className="text-lg font-semibold font-mono-tight text-foreground">{value}</div>
      <div className="text-2xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 0) return formatFutureTime(ts)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatFutureTime(ts: number): string {
  const diff = ts - Date.now()
  if (diff < 60_000) return 'in <1m'
  if (diff < 3_600_000) return `in ${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h`
  const d = new Date(ts)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const day = days[d.getDay()]
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day} ${time}`
}

function formatScheduleTime(ts: number): string {
  const d = new Date(ts)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const day = days[d.getDay()]
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day} ${time}`
}
