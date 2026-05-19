/* attach-os override — Apple-style filter bar with removable chips */
'use client'

export type GroupBy = 'status' | 'agent' | 'priority' | 'project'

export interface KanbanFiltersState {
  assignee?: string
  priority?: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  project?: string
  search: string
}

interface Props {
  filters: KanbanFiltersState
  groupBy: GroupBy
  onFiltersChange: (next: KanbanFiltersState) => void
  onGroupByChange: (next: GroupBy) => void
  agents: { id: string; name: string }[]
  projects: { prefix: string; name: string }[]
}

export function KanbanFilters({ filters, groupBy, onFiltersChange, onGroupByChange, agents, projects }: Props) {
  const activeChips: { key: keyof KanbanFiltersState; label: string }[] = []
  if (filters.assignee) {
    const agent = agents.find(a => a.id === filters.assignee)
    activeChips.push({ key: 'assignee', label: `Assignee: ${agent?.name ?? filters.assignee}` })
  }
  if (filters.priority) activeChips.push({ key: 'priority', label: `Priority: ${filters.priority}` })
  if (filters.project) activeChips.push({ key: 'project', label: `Project: ${filters.project}` })

  const removeFilter = (key: keyof KanbanFiltersState) =>
    onFiltersChange({ ...filters, [key]: key === 'search' ? '' : undefined })

  const clearAll = () => onFiltersChange({ assignee: undefined, priority: undefined, project: undefined, search: '' })

  return (
    <div className="space-y-3 px-4 md:px-6 py-3 border-b border-border/50">
      <div className="flex flex-wrap items-center gap-2">
        {/* Group by selector */}
        <select
          value={groupBy}
          onChange={e => onGroupByChange(e.target.value as GroupBy)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="status">Group by: Status</option>
          <option value="agent">Group by: Agent</option>
          <option value="priority">Group by: Priority</option>
          <option value="project">Group by: Project</option>
        </select>

        {/* Agent filter */}
        {agents.length > 0 && (
          <select
            value={filters.assignee ?? ''}
            onChange={e => onFiltersChange({ ...filters, assignee: e.target.value || undefined })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">Todos los agentes</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}

        {/* Priority filter */}
        <select
          value={filters.priority ?? ''}
          onChange={e => onFiltersChange({ ...filters, priority: (e.target.value || undefined) as KanbanFiltersState['priority'] })}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="">Prioridad</option>
          <option value="critical">P0 — Critical</option>
          <option value="urgent">P0 — Urgent</option>
          <option value="high">P1 — High</option>
          <option value="medium">P2 — Medium</option>
          <option value="low">P3 — Low</option>
        </select>

        {/* Project filter */}
        {projects.length > 0 && (
          <select
            value={filters.project ?? ''}
            onChange={e => onFiltersChange({ ...filters, project: e.target.value || undefined })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">Proyecto</option>
            {projects.map(p => <option key={p.prefix} value={p.prefix}>{p.name}</option>)}
          </select>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            type="text"
            placeholder="Buscar tareas..."
            value={filters.search}
            onChange={e => onFiltersChange({ ...filters, search: e.target.value })}
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeChips.map(chip => (
            <button
              key={chip.key}
              aria-label={`Remove filter ${chip.label.split(':')[0]}`}
              onClick={() => removeFilter(chip.key)}
              className="inline-flex items-center gap-1.5 text-xs bg-muted text-muted-foreground hover:bg-muted/70 rounded-full pl-3 pr-2 py-1.5 transition-colors"
            >
              {chip.label}
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          ))}
          <button
            onClick={clearAll}
            className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  )
}