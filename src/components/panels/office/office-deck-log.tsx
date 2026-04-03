'use client'

// Deck Log overlay — event stream, legend, and hotspot inspector with nudge/resize controls.

import { Button } from '@/components/ui/button'
import type { OfficeEvent, OfficeHotspot } from './office-types'
import { formatLastSeen } from './office-utils'

interface OfficeDeckLogProps {
  officeEvents: OfficeEvent[]
  selectedHotspot: OfficeHotspot | null
  nudgeSelectedHotspot: (dx: number, dy: number) => void
  resizeSelectedRoom: (dw: number, dh: number) => void
}

export function OfficeDeckLog({
  officeEvents,
  selectedHotspot,
  nudgeSelectedHotspot,
  resizeSelectedRoom,
}: OfficeDeckLogProps): React.ReactElement {
  return (
    <div
      className="absolute left-3 bottom-3 z-30 w-72 rounded-md border border-void-cyan/15 bg-card/88 backdrop-blur-sm p-2.5 space-y-2"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="text-[10px] text-void-cyan/60 font-mono uppercase tracking-wider">Deck Log</div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-void-amber" />Active
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-void-mint" />Standby
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-void-cyan" />Other
        </span>
      </div>

      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1" onWheel={(event) => event.stopPropagation()}>
        {officeEvents.length === 0 && (
          <div className="text-[11px] text-muted-foreground">No events yet. Click a zone or run an action.</div>
        )}
        {officeEvents.map((event) => (
          <div key={event.id} className="text-[11px] rounded px-2 py-1 bg-secondary/50 border border-border">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`uppercase font-mono text-[9px] ${
                  event.severity === 'good'
                    ? 'text-void-mint'
                    : event.severity === 'warn'
                      ? 'text-void-amber'
                      : 'text-void-cyan'
                }`}
              >
                {event.kind}
              </span>
              <span className="text-muted-foreground text-[9px]">{formatLastSeen(Math.floor(event.at / 1000))}</span>
            </div>
            <div className="text-foreground/80">{event.message}</div>
          </div>
        ))}
      </div>

      {selectedHotspot && (
        <div className="rounded border border-void-cyan/15 bg-secondary/50 p-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold text-foreground">{selectedHotspot.label}</div>
            <div className="text-[9px] font-mono uppercase text-void-cyan/60">{selectedHotspot.kind}</div>
          </div>
          <div className="mt-1.5 space-y-1">
            {selectedHotspot.stats.map((line) => (
              <div key={line} className="text-[10px] text-slate-300">{line}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(0, -1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Up</Button>
            <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(-1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Left</Button>
            <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Right</Button>
            <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(0, 1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Down</Button>
            <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(-0.5, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Fine -X</Button>
            <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(0.5, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Fine +X</Button>
          </div>
          {selectedHotspot.kind === 'room' && (
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Wider</Button>
              <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(-1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Narrower</Button>
              <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(0, 1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Taller</Button>
              <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(0, -1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">Shorter</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
