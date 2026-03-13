/**
 * Bidirectional mapping between Mission Control and Linear.
 */

export type TaskStatus = 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  color: string
}

export function statusToLinearStateType(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    inbox: 'backlog',
    assigned: 'unstarted',
    in_progress: 'started',
    review: 'started',
    quality_review: 'started',
    done: 'completed',
  }
  return map[status] || 'backlog'
}

export function linearStateTypeToStatus(
  stateType: string,
  stateName?: string
): TaskStatus {
  if (stateName) {
    const lowerName = stateName.toLowerCase()
    if (lowerName.includes('review') || lowerName.includes('qa')) return 'review'
    if (lowerName.includes('test')) return 'review'
    if (lowerName.includes('progress') || lowerName.includes('doing')) return 'in_progress'
    if (lowerName.includes('assign')) return 'assigned'
    if (lowerName.includes('done') || lowerName.includes('complete')) return 'done'
  }

  const map: Record<string, TaskStatus> = {
    backlog: 'inbox',
    unstarted: 'assigned',
    started: 'in_progress',
    completed: 'done',
    canceled: 'done',
  }
  return map[stateType] || 'inbox'
}

export function findMatchingWorkflowState(
  status: TaskStatus,
  workflowStates: LinearWorkflowState[]
): LinearWorkflowState | null {
  const targetType = statusToLinearStateType(status)

  let match = workflowStates.find(s => s.type === targetType)
  if (match) return match

  const typeCategories: Record<string, string[]> = {
    backlog: ['backlog'],
    unstarted: ['unstarted'],
    started: ['started'],
    completed: ['completed', 'canceled'],
  }

  const category = typeCategories[targetType] || []
  match = workflowStates.find(s => category.includes(s.type))

  return match || workflowStates[0] || null
}

export function priorityToLinear(priority: TaskPriority): number {
  const map: Record<TaskPriority, number> = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
  }
  return map[priority] || 3
}

export function linearToPriority(linearPriority: number): TaskPriority {
  const map: Record<number, TaskPriority> = {
    1: 'critical',
    2: 'high',
    3: 'medium',
    4: 'low',
  }
  return map[linearPriority] || 'medium'
}
