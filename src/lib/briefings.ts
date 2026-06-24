/**
 * Briefing generation — shared core used by both the HTTP route
 * (`/api/briefings/generate`) and the daily scheduler (`runDailyBriefings`).
 *
 * Kept side-effect-light: callers pass the db handle + actor so this module
 * works the same whether invoked from an authenticated request or the
 * background scheduler.
 */

import type Database from 'better-sqlite3'
import { db_helpers } from './db'

export interface BriefingTask {
  id: number
  title: string
  status?: string
  priority?: string
  due_date?: number | null
  description?: string | null
}

export interface BriefingMetrics {
  inProgress: number
  assigned: number
  review: number
  completedToday: number
}

export interface GeneratedBriefing {
  agentName: string
  date: string
  content: string
  urgencyItems: BriefingTask[]
  calendarItems: { today: BriefingTask[]; tomorrow: BriefingTask[] }
  metrics: BriefingMetrics
}

/**
 * Generate (and persist) a briefing for a single agent on a given date.
 * Returns null if the agent does not exist in the workspace.
 */
export function generateAgentBriefing(
  db: Database.Database,
  opts: { agentName: string; date?: string; workspaceId: number; actor: string },
): GeneratedBriefing | null {
  const { agentName, workspaceId, actor } = opts
  const targetDate = opts.date || new Date().toISOString().split('T')[0]

  const agent = db
    .prepare('SELECT id FROM agents WHERE name = ? AND workspace_id = ?')
    .get(agentName, workspaceId) as { id: number } | undefined
  if (!agent) return null

  // Urgent: urgent/high priority OR overdue, not done.
  const urgentTasks = db
    .prepare(
      `SELECT id, title, priority, due_date, status, description
       FROM tasks
       WHERE assigned_to = ? AND workspace_id = ?
         AND status NOT IN ('done')
         AND (priority IN ('urgent', 'high') OR (due_date IS NOT NULL AND due_date < ?))
       ORDER BY priority DESC, due_date ASC
       LIMIT 10`,
    )
    .all(agentName, workspaceId, Math.floor(Date.now() / 1000)) as BriefingTask[]

  // Calendar windows.
  const startOfDay = Math.floor(new Date(`${targetDate}T00:00:00Z`).getTime() / 1000)
  const endOfDay = Math.floor(new Date(`${targetDate}T23:59:59Z`).getTime() / 1000)
  const startOfTomorrow = endOfDay + 1
  const tomorrowDate = new Date(new Date(targetDate).getTime() + 86400000)
    .toISOString()
    .split('T')[0]
  const endOfTomorrow = Math.floor(new Date(`${tomorrowDate}T23:59:59Z`).getTime() / 1000)

  const todayTasks = db
    .prepare(
      `SELECT id, title, status, priority, due_date
       FROM tasks
       WHERE assigned_to = ? AND workspace_id = ?
         AND status NOT IN ('done')
         AND due_date BETWEEN ? AND ?
       ORDER BY due_date ASC`,
    )
    .all(agentName, workspaceId, startOfDay, endOfDay) as BriefingTask[]

  const tomorrowTasks = db
    .prepare(
      `SELECT id, title, status, priority, due_date
       FROM tasks
       WHERE assigned_to = ? AND workspace_id = ?
         AND status NOT IN ('done')
         AND due_date BETWEEN ? AND ?
       ORDER BY due_date ASC`,
    )
    .all(agentName, workspaceId, startOfTomorrow, endOfTomorrow) as BriefingTask[]

  const inProgress = (db
    .prepare(`SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status = 'in_progress'`)
    .get(agentName, workspaceId) as { count: number }).count
  const assigned = (db
    .prepare(`SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status = 'assigned'`)
    .get(agentName, workspaceId) as { count: number }).count
  const review = (db
    .prepare(`SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status IN ('review', 'quality_review')`)
    .get(agentName, workspaceId) as { count: number }).count
  const completedToday = (db
    .prepare(`SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status = 'done' AND updated_at BETWEEN ? AND ?`)
    .get(agentName, workspaceId, startOfDay, endOfDay) as { count: number }).count

  const metrics: BriefingMetrics = { inProgress, assigned, review, completedToday }

  const content = buildBriefingContent({
    agentName,
    date: targetDate,
    urgentTasks,
    todayTasks,
    tomorrowTasks,
    metrics,
  })

  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `INSERT OR REPLACE INTO briefings
       (agent_name, date, content, urgency_items, calendar_items, metrics, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agentName,
    targetDate,
    content,
    JSON.stringify(urgentTasks.slice(0, 5)),
    JSON.stringify([
      ...todayTasks.map((t) => ({ ...t, period: 'today' })),
      ...tomorrowTasks.map((t) => ({ ...t, period: 'tomorrow' })),
    ]),
    JSON.stringify(metrics),
    now,
    now,
    workspaceId,
  )

  db_helpers.logActivity(
    'briefing_generated',
    'briefing',
    0,
    actor,
    `Generated briefing for ${agentName} on ${targetDate}`,
    { agentName, date: targetDate, urgentItemsCount: urgentTasks.length, todayTasksCount: todayTasks.length },
    workspaceId,
  )

  return {
    agentName,
    date: targetDate,
    content,
    urgencyItems: urgentTasks.slice(0, 5),
    calendarItems: { today: todayTasks, tomorrow: tomorrowTasks },
    metrics,
  }
}

/** Build the markdown briefing body. */
export function buildBriefingContent(params: {
  agentName: string
  date: string
  urgentTasks: BriefingTask[]
  todayTasks: BriefingTask[]
  tomorrowTasks: BriefingTask[]
  metrics: BriefingMetrics
}): string {
  const { agentName, date, urgentTasks, todayTasks, tomorrowTasks, metrics } = params

  let content = `# Morning Briefing — ${agentName} — ${date}\n\n`

  if (urgentTasks.length > 0) {
    content += `## 🔴 URGENT — Do These First\n\n`
    urgentTasks.slice(0, 5).forEach((task, idx) => {
      content += `**${idx + 1}. ${task.title}**\n`
      if (task.description) {
        content += `${task.description.substring(0, 150)}...\n`
      }
      content += `\n`
    })
  }

  if (todayTasks.length > 0 || tomorrowTasks.length > 0) {
    content += `## 📅 Your Calendar\n\n`
    if (todayTasks.length > 0) {
      content += `### Today\n`
      todayTasks.forEach((task) => {
        content += `- ${task.title}\n`
      })
      content += `\n`
    }
    if (tomorrowTasks.length > 0) {
      content += `### Tomorrow (preview)\n`
      tomorrowTasks.forEach((task) => {
        content += `- ${task.title}\n`
      })
      content += `\n`
    }
  }

  content += `## 📊 Your Status\n\n`
  content += `- **In Progress**: ${metrics.inProgress} tasks\n`
  content += `- **Assigned**: ${metrics.assigned} tasks waiting\n`
  content += `- **In Review**: ${metrics.review} tasks\n`
  content += `- **Completed Today**: ${metrics.completedToday} tasks\n`

  return content
}
