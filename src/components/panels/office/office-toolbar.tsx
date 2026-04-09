'use client'

import { Button } from '@/components/ui/button'
import type { TimeTheme } from './office-types'

interface OfficeToolbarProps {
  mapZoom: number
  setMapZoom: React.Dispatch<React.SetStateAction<number>>
  timeTheme: TimeTheme
  setTimeTheme: (theme: TimeTheme) => void
  showSidebar: boolean
  setShowSidebar: React.Dispatch<React.SetStateAction<boolean>>
  showMinimap: boolean
  setShowMinimap: React.Dispatch<React.SetStateAction<boolean>>
  showEvents: boolean
  setShowEvents: React.Dispatch<React.SetStateAction<boolean>>
  resetOfficeLayout: () => void
  resetMapView: () => void
}

export function OfficeToolbar({
  mapZoom,
  setMapZoom,
  timeTheme,
  setTimeTheme,
  showSidebar,
  setShowSidebar,
  showMinimap,
  setShowMinimap,
  showEvents,
  setShowEvents,
  resetOfficeLayout,
  resetMapView,
}: OfficeToolbarProps): React.ReactElement {
  return (
    <>
      {/* Label */}
      <div className="absolute left-[8%] top-[8%] rounded-md bg-card/80 backdrop-blur-sm border border-void-cyan/20 text-void-cyan text-xs px-2 py-1 font-mono z-30">
        MAIN DECK
      </div>

      {/* Zoom controls */}
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
        <Button variant="ghost" size="xs" onClick={() => setMapZoom((z) => Math.max(0.8, Number((z - 0.1).toFixed(2))))} className="h-auto px-1.5 py-0.5 text-xs hover:bg-void-cyan/10">-</Button>
        <span className="text-[11px] font-mono w-10 text-center">{Math.round(mapZoom * 100)}%</span>
        <Button variant="ghost" size="xs" onClick={() => setMapZoom((z) => Math.min(2.2, Number((z + 0.1).toFixed(2))))} className="h-auto px-1.5 py-0.5 text-xs hover:bg-void-cyan/10">+</Button>
        <Button variant="ghost" size="xs" onClick={resetMapView} className="h-auto px-1.5 py-0.5 text-[11px] hover:bg-void-cyan/10">Reset</Button>
      </div>

      {/* Time-theme selector */}
      <div className="absolute right-3 top-12 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
        {(['dawn', 'day', 'dusk', 'night'] as TimeTheme[]).map((item) => (
          <Button
            key={item}
            variant="ghost"
            size="xs"
            onClick={() => setTimeTheme(item)}
            className={`h-auto px-1.5 py-0.5 text-[10px] font-mono uppercase ${timeTheme === item ? 'bg-void-cyan/20 text-void-cyan' : 'hover:bg-void-cyan/10 text-muted-foreground'}`}
          >
            {item}
          </Button>
        ))}
      </div>

      {/* Panel toggles */}
      <div className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
        <Button variant="ghost" size="xs" onClick={() => setShowSidebar((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showSidebar ? 'Hide Crew' : 'Show Crew'}</Button>
        <Button variant="ghost" size="xs" onClick={() => setShowMinimap((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showMinimap ? 'Hide Radar' : 'Show Radar'}</Button>
        <Button variant="ghost" size="xs" onClick={() => setShowEvents((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showEvents ? 'Hide Log' : 'Show Log'}</Button>
        <Button variant="ghost" size="xs" onClick={resetOfficeLayout} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">Reset Layout</Button>
      </div>
    </>
  )
}
