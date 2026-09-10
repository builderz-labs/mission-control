'use client'

import {
  QuickAction,
  SpawnActionIcon,
  LogActionIcon,
  TaskActionIcon,
  MemoryActionIcon,
  SessionIcon,
  PipelineActionIcon,
  type DashboardData,
} from '../widget-primitives'
import { EngineLogoSet } from '@/components/brand/engine-logo'

/** Pick contextual actions based on current fleet/task state */
function getContextualActions(data: DashboardData): Array<{
  label: string
  desc: React.ReactNode
  tab: string
  icon: React.ReactNode
  priority: number
}> {
  const {
    isLocal,
    activeSessions,
    errorCount,
    reviewCount,
    runningTasks,
    backlogCount,
    agents,
    dbStats,
  } = data

  const actions: Array<{
    label: string
    desc: React.ReactNode
    tab: string
    icon: React.ReactNode
    priority: number
  }> = []

  const agentTotal = dbStats?.agents.total ?? agents.length

  // High priority: errors need attention
  if (errorCount > 0) {
    actions.push({
      label: 'Check Error Logs',
      desc: `${errorCount} error${errorCount !== 1 ? 's' : ''} detected`,
      tab: 'logs',
      icon: <LogActionIcon />,
      priority: 100,
    })
  }

  // High priority: tasks waiting for review
  if (reviewCount > 0) {
    actions.push({
      label: 'Review Pending Tasks',
      desc: `${reviewCount} task${reviewCount !== 1 ? 's' : ''} awaiting review`,
      tab: 'tasks',
      icon: <TaskActionIcon />,
      priority: 90,
    })
  }

  // Contextual: agents/sessions idle — suggest dispatching work
  if (activeSessions === 0 && agentTotal > 0) {
    actions.push({
      label: 'Dispatch a Task',
      desc: 'Agents are idle',
      tab: 'tasks',
      icon: <TaskActionIcon />,
      priority: 70,
    })
  }

  // No agents at all — guide to setup
  if (!isLocal && agentTotal === 0) {
    actions.push({
      label: 'Create First Agent',
      desc: 'Set up your agent fleet',
      tab: 'agents',
      icon: <SpawnActionIcon />,
      priority: 80,
    })
  }

  // Default navigation actions (always available, lower priority)
  if (isLocal) {
    actions.push({
      label: 'Sessions',
      desc: (
        <span className="inline-flex items-center gap-1.5">
          <EngineLogoSet kinds={['claude-code', 'codex-cli']} size={12} decorative />
          <span>Claude + Codex + Hermes</span>
        </span>
      ),
      tab: 'sessions',
      icon: <SessionIcon />,
      priority: 30,
    })
  } else {
    actions.push({
      label: 'Agents',
      desc: 'Fleet management',
      tab: 'agents',
      icon: <PipelineActionIcon />,
      priority: 30,
    })
  }

  actions.push({
    label: 'View Logs',
    desc: 'Realtime viewer',
    tab: 'logs',
    icon: <LogActionIcon />,
    priority: 20,
  })

  actions.push({
    label: 'Task Board',
    desc: `${runningTasks} running · ${backlogCount} queued`,
    tab: 'tasks',
    icon: <TaskActionIcon />,
    priority: 25,
  })

  actions.push({
    label: 'Memory',
    desc: 'Knowledge + recall',
    tab: 'memory',
    icon: <MemoryActionIcon />,
    priority: 10,
  })

  // Sort by priority descending, deduplicate by key
  const seen = new Set<string>()
  return actions
    .sort((a, b) => b.priority - a.priority)
    .filter((a) => {
      const key = `${a.tab}:${a.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 5)
}

export function QuickActionsWidget({ data }: { data: DashboardData }) {
  const { navigateToPanel } = data
  const actions = getContextualActions(data)

  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      {actions.map((action) => (
        <QuickAction
          key={`${action.tab}-${action.label}`}
          label={action.label}
          desc={action.desc}
          tab={action.tab}
          icon={action.icon}
          onNavigate={navigateToPanel}
        />
      ))}
    </section>
  )
}
