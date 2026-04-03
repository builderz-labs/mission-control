'use client'

// Org chart view — displays agents segmented by category, role, or status with card grid layout.

import { Button } from '@/components/ui/button'
import type { Agent } from '@/store'
import type { OrgSegmentMode } from './office-types'
import { hashColor, getInitials, statusDot, statusLabel, statusGlow } from './office-utils'

interface OrgChartProps {
  orgSegmentMode: OrgSegmentMode
  setOrgSegmentMode: (mode: OrgSegmentMode) => void
  orgGroups: Map<string, Agent[]>
  setSelectedAgent: (agent: Agent | null) => void
}

export function OrgChart({
  orgSegmentMode,
  setOrgSegmentMode,
  orgGroups,
  setSelectedAgent,
}: OrgChartProps): React.ReactElement {
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
          <Button
            variant={orgSegmentMode === 'category' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setOrgSegmentMode('category')}
            className="rounded-none"
          >
            Category
          </Button>
          <Button
            variant={orgSegmentMode === 'role' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setOrgSegmentMode('role')}
            className="rounded-none"
          >
            Role
          </Button>
          <Button
            variant={orgSegmentMode === 'status' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setOrgSegmentMode('status')}
            className="rounded-none"
          >
            Status
          </Button>
        </div>
      </div>

      {[...orgGroups.entries()].map(([segment, members]) => (
        <div key={segment} className="bg-card border border-border rounded-lg p-5">
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
