export interface OpenClawSessionLite {
  key: string
  updatedAt?: number
  model?: string
}

export interface OpenClawDerivedTask {
  taskId: string // proj:captaineer:YYYYMMDD:slug
  project: string
  date: string // YYYYMMDD
  slug: string
  sessions: { key: string; agentId?: string; updatedAt?: number; model?: string }[]
  lastUpdatedAt?: number
}

// agent:orion:proj:captaineer:20260304:gateway-banner
const SESSION_RE = /^agent:([^:]+):(proj:([^:]+):(\d{8}):([a-z0-9-]+))$/i

export function deriveTasksFromSessions(sessions: OpenClawSessionLite[]): OpenClawDerivedTask[] {
  const tasks = new Map<string, OpenClawDerivedTask>()

  for (const s of sessions) {
    const key = s.key || ''
    const m = key.match(SESSION_RE)
    if (!m) continue

    const agentId = m[1]
    const taskId = m[2]
    const project = m[3]
    const date = m[4]
    const slug = m[5]

    const existing = tasks.get(taskId)
    const sess = { key, agentId, updatedAt: s.updatedAt, model: s.model }

    if (!existing) {
      tasks.set(taskId, {
        taskId,
        project,
        date,
        slug,
        sessions: [sess],
        lastUpdatedAt: s.updatedAt
      })
    } else {
      existing.sessions.push(sess)
      existing.lastUpdatedAt = Math.max(existing.lastUpdatedAt ?? 0, s.updatedAt ?? 0)
    }
  }

  return Array.from(tasks.values()).sort((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0))
}
