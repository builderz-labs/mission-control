'use client'

// Radar minimap overlay — shows room outlines, corridor strip, and clickable worker dots.

import { Button } from '@/components/ui/button'
import type { Agent } from '@/store'
import type { MapRoom, RenderedWorker } from './office-types'
import { hashColor } from './office-utils'
import { clamp } from './office-utils'

interface OfficeminimapProps {
  roomLayoutState: MapRoom[]
  renderedWorkers: RenderedWorker[]
  focusMapPoint: (x: number, y: number) => void
  setSelectedAgent: (agent: Agent | null) => void
}

export function OfficeMinimap({
  roomLayoutState,
  renderedWorkers,
  focusMapPoint,
  setSelectedAgent,
}: OfficeminimapProps): React.ReactElement {
  return (
    <div
      className="absolute right-3 bottom-3 z-30 w-44 h-28 rounded-md border border-void-cyan/15 bg-card/85 backdrop-blur-sm p-1.5"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        const target = event.currentTarget
        const rect = target.getBoundingClientRect()
        const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100)
        const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
        focusMapPoint(x, y)
      }}
    >
      <div className="text-[9px] text-void-cyan/60 font-mono uppercase tracking-wider mb-1">Radar</div>
      <div className="relative w-full h-[calc(100%-16px)] rounded-sm overflow-hidden border border-void-cyan/10 bg-background">
        {roomLayoutState.map((room) => (
          <div
            key={`mini-${room.id}`}
            className="absolute border border-void-cyan/15 bg-void-cyan/5"
            style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.w}%`, height: `${room.h}%` }}
          />
        ))}
        {/* Central corridor strip */}
        <div className="absolute left-[14%] top-[47%] w-[72%] h-[4%] bg-void-cyan/20" />
        {renderedWorkers.map((worker) => (
          <Button
            key={`mini-worker-${worker.agent.id}`}
            variant="ghost"
            className={`absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 ${hashColor(worker.agent.name)} border border-black/40 h-auto p-0 min-w-0 hover:bg-transparent`}
            style={{ left: `${worker.x}%`, top: `${worker.y}%` }}
            onClick={(event) => {
              event.stopPropagation()
              setSelectedAgent(worker.agent)
              focusMapPoint(worker.x, worker.y)
            }}
            title={worker.agent.name}
          />
        ))}
      </div>
    </div>
  )
}
