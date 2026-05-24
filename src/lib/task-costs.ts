export interface TokenCostRecord {
  model: string
  agentName: string
  timestamp: number
  totalTokens: number
  cost: number
  taskId?: number | null
}

export interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

export interface TaskCostMetadata {
  id: number
  title: string
  status: string
  priority: string
  assigned_to?: string | null
  project_id?: number | null
  project_name?: string | null
  project_slug?: string | null
  project_ticket_no?: number | null
  project_prefix?: string | null
}

export interface TaskCostEntry {
  taskId: number
  title: string
  status: string
  priority: string
  assignedTo?: string | null
  project: {
    id?: number | null
    name?: string | null
    slug?: string | null
    ticketRef?: string | null
  }
  stats: TokenStats
  models: Record<string, TokenStats>
  timeline: Array<{ date: string; cost: number; tokens: number }>
}

export interface AgentTaskCostEntry {
  stats: TokenStats
  taskCount: number
  taskIds: number[]
}

export interface ProjectTaskCostEntry {
  stats: TokenStats
  taskCount: number
  taskIds: number[]
}

export interface TaskCostReport {
  summary: TokenStats
  tasks: TaskCostEntry[]
  agents: Record<string, AgentTaskCostEntry>
  projects: Record<string, ProjectTaskCostEntry>
  unattributed: TokenStats
}

export function calculateStats(records: TokenCostRecord[]): TokenStats {
  if (records.length === 0) {
    return {
      totalTokens: 0,
      totalCost: 0,
      requestCount: 0,
      avgTokensPerRequest: 0,
      avgCostPerRequest: 0,
    }
  }

  const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0)
  const totalCost = records.reduce((sum, r) => sum + r.cost, 0)
  const requestCount = records.length

  return {
    totalTokens,
    totalCost,
    requestCount,
    avgTokensPerRequest: Math.round(totalTokens / requestCount),
    avgCostPerRequest: totalCost / requestCount,
  }
}

function groupByModel(records: TokenCostRecord[]): Record<string, TokenStats> {
  const modelGroups: Record<string, TokenCostRecord[]> = {}
  for (const record of records) {
    if (!modelGroups[record.model]) modelGroups[record.model] = []
    modelGroups[record.model].push(record)
  }

  const result: Record<string, TokenStats> = {}
  for (const [model, modelRecords] of Object.entries(modelGroups)) {
    result[model] = calculateStats(modelRecords)
  }
  return result
}

function buildTimeline(records: TokenCostRecord[]): Array<{ date: string; cost: number; tokens: number }> {
  const byDate: Record<string, { cost: number; tokens: number }> = {}

  for (const record of records) {
    const date = new Date(record.timestamp).toISOString().split('T')[0]
    if (!byDate[date]) {
      byDate[date] = { cost: 0, tokens: 0 }
    }
    byDate[date].cost += record.cost
    byDate[date].tokens += record.totalTokens
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totals]) => ({ date, ...totals }))
}

function formatTicketRef(prefix?: string | null, num?: number | null): string | null {
  if (!prefix || typeof num !== 'number' || !Number.isFinite(num) || num <= 0) return null
  return `${prefix}-${String(num).padStart(3, '0')}`
}

export function buildTaskCostReport(records: TokenCostRecord[], taskMetadata: Record<number, TaskCostMetadata>): TaskCostReport {
  const attributedRecords = records.filter((record) => Number.isFinite(record.taskId))
  const unattributedRecords = records.filter((record) => !Number.isFinite(record.taskId))

  const byTask: Record<number, TokenCostRecord[]> = {}
  for (const record of attributedRecords) {
    const taskId = Number(record.taskId)
    if (!taskMetadata[taskId]) continue
    if (!byTask[taskId]) byTask[taskId] = []
    byTask[taskId].push(record)
  }

  const tasks: TaskCostEntry[] = Object.entries(byTask)
    .map(([taskIdRaw, taskRecords]) => {
      const taskId = Number(taskIdRaw)
      const meta = taskMetadata[taskId]
      return {
        taskId,
        title: meta.title,
        status: meta.status,
        priority: meta.priority,
        assignedTo: meta.assigned_to || null,
        project: {
          id: meta.project_id ?? null,
          name: meta.project_name ?? null,
          slug: meta.project_slug ?? null,
          ticketRef: formatTicketRef(meta.project_prefix, meta.project_ticket_no),
        },
        stats: calculateStats(taskRecords),
        models: groupByModel(taskRecords),
        timeline: buildTimeline(taskRecords),
      }
    })
    .sort((a, b) => b.stats.totalCost - a.stats.totalCost)

  const byAgent: Record<string, TokenCostRecord[]> = {}
  for (const record of attributedRecords) {
    const taskId = Number(record.taskId)
    if (!taskMetadata[taskId]) continue
    if (!byAgent[record.agentName]) byAgent[record.agentName] = []
    byAgent[record.agentName].push(record)
  }

  const agentTaskIds: Record<string, Set<number>> = {}
  for (const task of tasks) {
    const taskRecords = byTask[task.taskId] || []
    for (const record of taskRecords) {
      const agent = record.agentName
      if (!agentTaskIds[agent]) agentTaskIds[agent] = new Set()
      agentTaskIds[agent].add(task.taskId)
    }
  }

  const agents: Record<string, AgentTaskCostEntry> = {}
  for (const [agent, agentRecords] of Object.entries(byAgent)) {
    const taskIds = [...(agentTaskIds[agent] || new Set<number>())].toSorted((a, b) => a - b)
    agents[agent] = {
      stats: calculateStats(agentRecords),
      taskCount: taskIds.length,
      taskIds,
    }
  }

  const byProject: Record<string, TokenCostRecord[]> = {}
  const projectTaskIds: Record<string, Set<number>> = {}
  for (const record of attributedRecords) {
    const taskId = Number(record.taskId)
    const meta = taskMetadata[taskId]
    if (!meta) continue
    const key = meta.project_id ? String(meta.project_id) : 'unscoped'
    if (!byProject[key]) byProject[key] = []
    byProject[key].push(record)
    if (!projectTaskIds[key]) projectTaskIds[key] = new Set()
    projectTaskIds[key].add(taskId)
  }

  const projects: Record<string, ProjectTaskCostEntry> = {}
  for (const [projectKey, projectRecords] of Object.entries(byProject)) {
    const taskIds = [...(projectTaskIds[projectKey] || new Set<number>())].toSorted((a, b) => a - b)
    projects[projectKey] = {
      stats: calculateStats(projectRecords),
      taskCount: taskIds.length,
      taskIds,
    }
  }

  return {
    summary: calculateStats(attributedRecords.filter((record) => Number.isFinite(record.taskId) && taskMetadata[Number(record.taskId)])),
    tasks,
    agents,
    projects,
    unattributed: calculateStats(unattributedRecords),
  }
}
