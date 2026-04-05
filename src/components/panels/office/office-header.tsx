'use client'

// Header toolbar for the Command Deck panel.
// Displays live status counts and view-mode toggle.

import { Button } from '@/components/ui/button'
import type { ViewMode } from './office-types'

interface OfficeCounts {
  readonly idle: number
  readonly busy: number
  readonly error: number
  readonly offline: number
}

interface OfficeHeaderProps {
  readonly counts: OfficeCounts
  readonly viewMode: ViewMode
  readonly setViewMode: (v: ViewMode) => void
  readonly onRefresh: () => void
}

export function OfficeHeader({ counts, viewMode, setViewMode, onRefresh }: OfficeHeaderProps): React.ReactElement {
  return (
    <div className="border-b border-border pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Command Deck</h1>
          <p className="text-muted-foreground mt-1">Monitor your crew in real time</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadges counts={counts} />
          <div className="flex rounded-md overflow-hidden border border-border">
            <Button
              variant={viewMode === 'office' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('office')}
              className="rounded-none"
            >
              Deck
            </Button>
            <Button
              variant={viewMode === 'org-chart' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('org-chart')}
              className="rounded-none"
            >
              Crew Chart
            </Button>
          </div>
          <Button variant="secondary" size="sm" onClick={onRefresh}>Refresh</Button>
        </div>
      </div>
    </div>
  )
}

function StatusBadges({ counts }: { readonly counts: OfficeCounts }): React.ReactElement {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground mr-4">
      {counts.busy > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-void-amber" />{counts.busy} active
        </span>
      )}
      {counts.idle > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-void-mint" />{counts.idle} standby
        </span>
      )}
      {counts.error > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-void-crimson" />{counts.error} alert
        </span>
      )}
      {counts.offline > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />{counts.offline} offline
        </span>
      )}
    </div>
  )
}
