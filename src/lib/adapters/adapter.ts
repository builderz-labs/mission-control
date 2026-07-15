import { getDatabase } from '@/lib/db'

export function queryPendingAssignments(agentId: string, workspaceId: number): Assignment[] {
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT id, title, description, priority
      FROM tasks
      WHERE (assigned_to = ? OR assigned_to IS NULL)
        AND workspace_id = ?
        AND status IN ('assigned', 'inbox')
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
        due_date ASC,
        created_at ASC
      LIMIT 5
    `).all(agentId, workspaceId) as Array<{ id: number; title: string; description: string | null; priority: string }>

    return rows.map(row => ({
      taskId: String(row.id),
      description: row.title + (row.description ? `\n${row.description}` : ''),
      priority: row.priority === 'critical' ? 0 : row.priority === 'high' ? 1 : row.priority === 'medium' ? 2 : 3,
    }))
  } catch {
    return []
  }
}

export interface AgentRegistration {
  agentId: string
  name: string
  framework: string
  metadata?: Record<string, unknown>
  workspaceId: number
}

export interface HeartbeatPayload {
  agentId: string
  status: string
  metrics?: Record<string, unknown>
  workspaceId: number
}

export interface TaskReport {
  taskId: string
  agentId: string
  progress: number
  status: string
  output?: unknown
  workspaceId: number
}

export interface Assignment {
  taskId: string
  description: string
  priority?: number
  metadata?: Record<string, unknown>
}

export interface FrameworkAdapter {
  readonly framework: string
  register(agent: AgentRegistration): Promise<void>
  heartbeat(payload: HeartbeatPayload): Promise<void>
  reportTask(report: TaskReport): Promise<void>
  getAssignments(agentId: string, workspaceId: number): Promise<Assignment[]>
  disconnect(agentId: string, workspaceId: number): Promise<void>
}
