/* attach-os override — Pure filter + group functions for kanban (uses real upstream task shape) */

import type { GroupBy, KanbanFiltersState } from '@/components/attach/kanban-filters'

interface FilterableTask {
  id: number
  title: string
  status: string
  assigned_to?: string
  priority?: string
  project_prefix?: string
  description?: string
}

export function applyFilters<T extends FilterableTask>(tasks: T[], f: KanbanFiltersState): T[] {
  return tasks.filter(t => {
    if (f.assignee && t.assigned_to !== f.assignee) return false
    if (f.priority && t.priority !== f.priority) return false
    if (f.project && t.project_prefix !== f.project) return false
    if (f.search?.trim()) {
      const q = f.search.toLowerCase()
      const hay = `${t.title} ${t.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function groupTasks<T extends FilterableTask>(tasks: T[], by: GroupBy): Record<string, T[]> {
  const groups: Record<string, T[]> = {}
  for (const t of tasks) {
    const key = by === 'status'   ? t.status
              : by === 'agent'    ? (t.assigned_to ?? 'Unassigned')
              : by === 'priority' ? (t.priority ?? 'none')
              : by === 'project'  ? (t.project_prefix ?? 'no-project')
              : 'unknown'
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }
  return groups
}