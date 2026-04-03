'use client'

// Bottom-right toast notification for agent launch / action feedback.

import type { LaunchToast } from './office-types'

interface OfficeLaunchToastProps {
  launchToast: LaunchToast
}

export function OfficeLaunchToast({ launchToast }: OfficeLaunchToastProps): React.ReactElement {
  const dotColor =
    launchToast.kind === 'success'
      ? 'bg-green-400'
      : launchToast.kind === 'info'
        ? 'bg-blue-400'
        : 'bg-red-400'

  return (
    <div className="fixed right-4 bottom-4 z-[70] max-w-sm rounded-lg border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-2xl">
      <div className="flex items-start gap-2">
        <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${dotColor}`} />
        <div>
          <div className="text-sm font-semibold text-foreground">{launchToast.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{launchToast.detail}</div>
        </div>
      </div>
    </div>
  )
}
