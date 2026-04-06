'use client'

interface Notification {
  id: number
  type: string
  title: string
  message: string
  created_at: number
}

interface ChatIndicatorsProps {
  notifications: Notification[]
}

const TOAST_DURATION_S = 8

/**
 * Inline toast indicators for compaction and model fallback events.
 * Only renders for the last 8 seconds — avoids stale UI clutter.
 */
export function ChatIndicators({ notifications }: ChatIndicatorsProps): React.ReactElement | null {
  const now = Math.floor(Date.now() / 1000)

  const recentToasts = notifications
    .filter((n) => {
      const age = now - n.created_at
      if (age > TOAST_DURATION_S) return false
      return n.title === 'Context Compaction' || n.title === 'Model Fallback'
    })
    .slice(0, 3)

  if (recentToasts.length === 0) return null

  return (
    <div className="flex flex-col gap-1 px-4 py-1 flex-shrink-0">
      {recentToasts.map((toast) => {
        const isCompaction = toast.title === 'Context Compaction'
        const isFallback = toast.title === 'Model Fallback'
        return (
          <div
            key={toast.id}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px] animate-in fade-in slide-in-from-bottom-1 ${
              isCompaction
                ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                : isFallback
                  ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                  : 'bg-surface-1 text-muted-foreground border border-border/30'
            }`}
          >
            <span className="font-medium">{toast.title}</span>
            <span className="text-current/70 truncate">{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}
