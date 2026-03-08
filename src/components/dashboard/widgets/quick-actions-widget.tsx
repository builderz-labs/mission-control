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

export function QuickActionsWidget({ data }: { data: DashboardData }) {
  const { isLocal, navigateToPanel } = data

  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      {!isLocal && <QuickAction label="Spawn Agent" desc="Launch sub-agent" tab="spawn" icon={<SpawnActionIcon />} onNavigate={navigateToPanel} />}
      <QuickAction label="View Logs" desc="Realtime viewer" tab="logs" icon={<LogActionIcon />} onNavigate={navigateToPanel} />
      <QuickAction label="Task Board" desc="Flow + queue control" tab="tasks" icon={<TaskActionIcon />} onNavigate={navigateToPanel} />
      <QuickAction label="Memory" desc="Knowledge + recall" tab="memory" icon={<MemoryActionIcon />} onNavigate={navigateToPanel} />
      {isLocal
        ? <QuickAction label="Sessions" desc="Claude + Codex" tab="sessions" icon={<SessionIcon />} onNavigate={navigateToPanel} />
        : <QuickAction label="Orchestration" desc="Workflows + pipelines" tab="agents" icon={<PipelineActionIcon />} onNavigate={navigateToPanel} />}
    </section>
  )
}
