'use client'

import type { Agent } from '@/store'
import type { SidebarFilter, RosterRow, RenderedWorker } from './types'
import { hashColor, getInitials, statusDot } from './types'

interface OfficeSidebarProps {
  visibleDisplayAgents: Agent[]
  sidebarFilter: SidebarFilter
  setSidebarFilter: (filter: SidebarFilter) => void
  isLocalMode: boolean
  localSessionFilter: 'running' | 'not-running'
  setLocalSessionFilter: (filter: 'running' | 'not-running') => void
  filteredRosterRows: RosterRow[]
  renderedWorkers: RenderedWorker[]
  setSelectedAgent: (agent: Agent | null) => void
  focusMapPoint: (x: number, y: number) => void
}

export function OfficeSidebar({
  visibleDisplayAgents,
  sidebarFilter,
  setSidebarFilter,
  isLocalMode,
  localSessionFilter,
  setLocalSessionFilter,
  filteredRosterRows,
  renderedWorkers,
  setSelectedAgent,
  focusMapPoint,
}: OfficeSidebarProps) {
  return (
    <div className="rounded-xl border border-border bg-[#1a1f2d] text-slate-100 p-3 h-fit">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold tracking-wider">TEAMY</div>
        <div className="text-[10px] text-slate-300">{visibleDisplayAgents.length} online</div>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {([
          { key: 'all', label: 'All' },
          { key: 'working', label: 'Working' },
          { key: 'idle', label: 'Idle' },
          { key: 'attention', label: 'Needs Attention' },
        ] as Array<{ key: SidebarFilter; label: string }>).map((item) => (
          <button
            key={item.key}
            onClick={() => setSidebarFilter(item.key)}
            className={`px-2 py-1 rounded text-[10px] border transition-smooth ${
              sidebarFilter === item.key
                ? 'bg-primary/25 border-primary/40 text-primary-foreground'
                : 'bg-black/20 border-white/10 text-slate-300 hover:bg-black/35'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {isLocalMode && (
        <div className="mb-2 flex gap-1.5">
          <button
            onClick={() => setLocalSessionFilter('running')}
            className={`flex-1 rounded border px-2 py-1 text-[10px] transition-smooth ${
              localSessionFilter === 'running'
                ? 'bg-primary/25 border-primary/40 text-primary-foreground'
                : 'bg-black/20 border-white/10 text-slate-300 hover:bg-black/35'
            }`}
          >
            Running
          </button>
          <button
            onClick={() => setLocalSessionFilter('not-running')}
            className={`flex-1 rounded border px-2 py-1 text-[10px] transition-smooth ${
              localSessionFilter === 'not-running'
                ? 'bg-amber-500/15 border-amber-500/60 text-amber-200'
                : 'bg-black/20 border-white/10 text-slate-300 hover:bg-black/35'
            }`}
          >
            Not Running
          </button>
        </div>
      )}
      <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
        {filteredRosterRows.map(({ agent, minutesIdle, needsAttention }) => (
          <button
            key={agent.id}
            onClick={() => {
              setSelectedAgent(agent)
              const worker = renderedWorkers.find((item) => item.agent.id === agent.id)
              if (worker) focusMapPoint(worker.x, worker.y)
            }}
            className={`w-full flex items-center gap-2 rounded-lg p-2 text-left transition-smooth ${
              needsAttention
                ? 'bg-amber-500/12 border border-amber-400/60 hover:bg-amber-500/20'
                : 'bg-black/20 border border-white/5 hover:bg-black/35'
            }`}
          >
            <span className={`w-6 h-6 rounded ${hashColor(agent.name)} flex items-center justify-center text-[10px] font-bold text-white`}>
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
          </button>
        ))}
        {filteredRosterRows.length === 0 && (
          <div className="text-[11px] text-slate-400 px-1 py-2">No workers in this filter.</div>
        )}
      </div>
    </div>
  )
}
