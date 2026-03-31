import type { Task } from '@/lib/db'

interface TaskStats {
  total: number
  byStatus: Record<string, number>
}

export interface MergedTaskStats extends TaskStats {
  dbTotal: number
  dbByStatus: Record<string, number>
  runtimeTotal: number
  runtimeByStatus: Record<string, number>
}

export function mergeRuntimeTaskStats(
  dbStats: TaskStats,
  runtimeTasks: Array<{ status?: Task['status'] | 'awaiting_owner' | string | null }>,
): MergedTaskStats {
  const runtimeByStatus: Record<string, number> = {}

  for (const task of runtimeTasks) {
    const status = String(task.status || 'unknown')
    runtimeByStatus[status] = (runtimeByStatus[status] || 0) + 1
  }

  const mergedByStatus: Record<string, number> = { ...dbStats.byStatus }
  for (const [status, count] of Object.entries(runtimeByStatus)) {
    mergedByStatus[status] = (mergedByStatus[status] || 0) + count
  }

  return {
    total: dbStats.total + runtimeTasks.length,
    byStatus: mergedByStatus,
    dbTotal: dbStats.total,
    dbByStatus: { ...dbStats.byStatus },
    runtimeTotal: runtimeTasks.length,
    runtimeByStatus,
  }
}
