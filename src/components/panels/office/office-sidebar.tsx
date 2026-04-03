'use client'

// Sidebar crew panel — shows filter buttons, local-session toggle, and scrollable roster list.

import { Button } from '@/components/ui/button'
import type { Agent } from '@/store'
import type { SidebarFilter, RenderedWorker } from './office-types'
import { hashColor, getInitials, statusDot } from './office-utils'

interface RosterRow {
  agent: Agent
  minutesIdle: number
  needsAttention: boolean
}

interface OfficeSidebarProps {
  filteredRosterRows: RosterRow[]
  sidebarFilter: SidebarFilter
  setSidebarFilter: (filter: SidebarFilter) => void
  isLocalMode: boolean
  localSessionFilter: 'running' | 'not-running'
  setLocalSessionFilter: (filter: 'running' | 'not-running') => void
  visibleDisplayAgents: Agent[]
  renderedWorkers: RenderedWorker[]
  focusMapPoint: (x: number, y: number) => void
  setSelectedAgent: (agent: Agent | null) => void
}

const FILTER_TABS: Array<{ key: SidebarFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'working', label: 'Working' },
  { key: 'idle', label: 'Idle' },
  { key: 'attention', label: 'Needs Attention' },
]

export function OfficeSidebar({
  filteredRosterRows,
  sidebarFilter,
  setSidebarFilter,
  isLocalMode,
  localSessionFilter,
  setLocalSessionFilter,
  visibleDisplayAgents,
  renderedWorkers,
  focusMapPoint,
  setSelectedAgent,
}: OfficeSidebarProps): React.ReactElement {
  return (
    <div className="void-panel text-foreground p-3 h-fit">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold font-mono tracking-wider text-void-cyan">CREW</div>
        <div className="text-[10px] text-muted-foreground">{visibleDisplayAgents.length} online</div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {FILTER_TABS.map((item) => (
          <Button
            key={item.key}
            variant="ghost"
            size="xs"
            onClick={() => setSidebarFilter(item.key)}
            className={`h-auto px-2 py-1 text-[10px] font-mono border ${
              sidebarFilter === item.key
                ? 'bg-void-cyan/15 border-void-cyan/30 text-void-cyan'
                : 'bg-secondary border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {isLocalMode && (
        <div className="mb-2 flex gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setLocalSessionFilter('running')}
            className={`flex-1 h-auto px-2 py-1 text-[10px] font-mono border ${
              localSessionFilter === 'running'
                ? 'bg-void-cyan/15 border-void-cyan/30 text-void-cyan'
                : 'bg-secondary border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            Running
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setLocalSessionFilter('not-running')}
            className={`flex-1 h-auto px-2 py-1 text-[10px] font-mono border ${
              localSessionFilter === 'not-running'
                ? 'bg-void-amber/15 border-void-amber/30 text-void-amber'
                : 'bg-secondary border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            Not Running
          </Button>
        </div>
      )}

      <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
        {filteredRosterRows.map(({ agent, minutesIdle, needsAttention }) => (
          <Button
            key={agent.id}
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedAgent(agent)
              const worker = renderedWorkers.find((item) => item.agent.id === agent.id)
              if (worker) focusMapPoint(worker.x, worker.y)
            }}
            className={`w-full flex items-center gap-2 rounded-lg p-2 text-left h-auto ${
              needsAttention
                ? 'bg-amber-500/12 border border-amber-400/60 hover:bg-amber-500/20'
                : 'bg-black/20 border border-white/5 hover:bg-black/35'
            }`}
          >
            <span
              className={`w-6 h-6 rounded ${hashColor(agent.name)} flex items-center justify-center text-[10px] font-bold text-white`}
            >
              {getInitials(agent.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium truncate">{agent.name}</span>
              <span className="block text-[10px] text-slate-300 truncate">{agent.role}</span>
              <span className="block text-[9px] text-slate-400 truncate">
                {agent.last_activity || 'No recent activity'}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <span className={`w-2 h-2 rounded-full ${statusDot[agent.status]}`} />
              <span className={`text-[9px] ${needsAttention ? 'text-amber-300 font-semibold' : 'text-slate-400'}`}>
                {agent.status === 'busy' ? 'active' : `${minutesIdle}m idle`}
              </span>
            </span>
          </Button>
        ))}
        {filteredRosterRows.length === 0 && (
          <div className="text-[11px] text-slate-400 px-1 py-2">No workers in this filter.</div>
        )}
      </div>
    </div>
  )
}
