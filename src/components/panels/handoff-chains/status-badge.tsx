'use client'

// Status-to-style map lives here so it's easy to extend without touching other files
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-secondary text-muted-foreground',
  active: 'bg-green-500/20 text-green-400',
  archived: 'bg-amber-500/20 text-amber-400',
  running: 'bg-amber-500/20 text-amber-400 animate-pulse',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
}

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  const cls = STATUS_STYLES[status] ?? 'bg-secondary text-muted-foreground'
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  )
}
