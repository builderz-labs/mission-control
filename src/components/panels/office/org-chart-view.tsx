'use client'

import type { Agent } from '@/store'
import type { OrgSegmentMode } from './types'
import { hashColor, getInitials, statusGlow, statusDot, statusLabel } from './types'

interface OrgChartViewProps {
  orgSegmentMode: OrgSegmentMode
  setOrgSegmentMode: (mode: OrgSegmentMode) => void
  orgGroups: Map<string, Agent[]>
  setSelectedAgent: (agent: Agent | null) => void
}

export function OrgChartView({
  orgSegmentMode,
  setOrgSegmentMode,
  orgGroups,
  setSelectedAgent,
}: OrgChartViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Segmented by{' '}
          <span className="font-medium text-foreground">
            {orgSegmentMode === 'category' ? 'category' : orgSegmentMode}
          </span>
        </div>
        <div className="flex rounded-md overflow-hidden border border-border">
          <button
            onClick={() => setOrgSegmentMode('category')}
            className={`px-3 py-1 text-sm transition-smooth ${orgSegmentMode === 'category' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
          >
            Category
          </button>
          <button
            onClick={() => setOrgSegmentMode('role')}
            className={`px-3 py-1 text-sm transition-smooth ${orgSegmentMode === 'role' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
          >
            Role
          </button>
          <button
            onClick={() => setOrgSegmentMode('status')}
            className={`px-3 py-1 text-sm transition-smooth ${orgSegmentMode === 'status' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
          >
            Status
          </button>
        </div>
      </div>

      {[...orgGroups.entries()].map(([segment, members]) => (
        <div key={segment} className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-6 bg-primary rounded-full" />
            <h3 className="font-semibold text-foreground">{segment}</h3>
            <span className="text-xs text-muted-foreground ml-1">({members.length})</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {members.map(agent => (
              <div
                key={agent.id}
                onClick={() => setSelectedAgent(agent)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all hover:scale-[1.02] ${statusGlow[agent.status]}`}
                style={{ background: 'var(--card)' }}
              >
                <div className={`w-8 h-8 rounded-full ${hashColor(agent.name)} flex items-center justify-center text-white font-bold text-xs`}>
                  {getInitials(agent.name)}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{agent.name}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot[agent.status]}`} />
                    {statusLabel[agent.status]}
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
