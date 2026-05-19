/* attach-os override — Apple-style spacious task card */

interface Task {
  id: number
  title: string
  status: string
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  assigned_to?: string
  project_prefix?: string
  project_ticket_no?: number
  description?: string
}

const priorityBadge: Record<Task['priority'], string | null> = {
  critical: 'P0',
  urgent: 'P0',
  high: 'P1',
  medium: 'P2',
  low: null,
}

const badgeClass: Record<string, string> = {
  P0: 'bg-destructive text-destructive-foreground',
  P1: 'bg-primary text-primary-foreground',
  P2: 'bg-accent text-accent-foreground',
}

export function KanbanCard({ task }: { task: Task }) {
  const badge = priorityBadge[task.priority]
  const initial = task.assigned_to?.[0]?.toUpperCase()
  const hasTicket = task.project_prefix && task.project_ticket_no != null
  const hasDescription = Boolean(task.description?.trim())

  return (
    <article className="group bg-card border border-border rounded-xl p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-grab active:cursor-grabbing select-none">
      {hasTicket && (
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-primary tracking-wide">
            {task.project_prefix}-{task.project_ticket_no}
          </p>
          {hasDescription && (
            <svg aria-label="Has comments" className="w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.5L2 14V3Z" />
            </svg>
          )}
        </div>
      )}
      <p className="text-sm text-foreground leading-snug">{task.title}</p>
      <div className="mt-3 flex items-center gap-2">
        {badge && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${badgeClass[badge]}`}>
            {badge}
          </span>
        )}
        {initial && (
          <span className="text-[10px] w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-medium">
            {initial}
          </span>
        )}
      </div>
    </article>
  )
}