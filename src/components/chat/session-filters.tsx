'use client'

import { FLEET_AGENT_NAMES } from '@/lib/fleet-agents'

export interface SessionFilterState {
  agent: string
  project: string
  active: string
  environment: string
}

export function SessionFilterBar({
  value,
  projects,
  onChange,
}: {
  value: SessionFilterState
  projects: string[]
  onChange: (next: SessionFilterState) => void
}) {
  const selectClass = 'h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground'
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
      <select className={selectClass} value={value.agent} onChange={(e) => onChange({ ...value, agent: e.target.value })}>
        <option value="">All agents</option>
        {FLEET_AGENT_NAMES.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
      <select className={selectClass} value={value.project} onChange={(e) => onChange({ ...value, project: e.target.value })}>
        <option value="">All projects</option>
        {projects.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
      <select className={selectClass} value={value.active} onChange={(e) => onChange({ ...value, active: e.target.value })}>
        <option value="">Active + inactive</option>
        <option value="1">Active</option>
        <option value="0">Inactive</option>
      </select>
      <select className={selectClass} value={value.environment} onChange={(e) => onChange({ ...value, environment: e.target.value })}>
        <option value="">All environments</option>
        <option value="local">Local CLI</option>
        <option value="gateway">Gateway</option>
        <option value="desktop">Desktop app</option>
      </select>
    </div>
  )
}
