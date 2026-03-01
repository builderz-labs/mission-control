import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { heavyLimiter } from '@/lib/rate-limit'

interface SearchResult {
  type: 'task' | 'agent' | 'activity' | 'audit' | 'message' | 'notification' | 'webhook' | 'pipeline'
  id: number
  title: string
  subtitle?: string
  excerpt?: string
  created_at: number
  relevance: number
}

/**
 * GET /api/search?q=<query>&type=<optional type filter>&limit=<optional>
 * Global search across all MC entities.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim()
  const typeFilter = searchParams.get('type')
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100)

  if (!query || query.length < 2) {
    return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
  }

  const db = getDatabase()
  const likeQ = `%${query}%`
  const results: SearchResult[] = []

  // Search tasks
  if (!typeFilter || typeFilter === 'task') {
    try {
      const tasks = db.prepare(`
        SELECT id, title, description, status, assigned_to, created_at
        FROM tasks WHERE title LIKE ? OR description LIKE ? OR assigned_to LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, likeQ, limit) as any[]
      for (const t of tasks) {
        results.push({
          type: 'task',
          id: t.id,
          title: t.title,
          subtitle: `${t.status} ${t.assigned_to ? `· ${t.assigned_to}` : ''}`,
          excerpt: truncateMatch(t.description, query),
          created_at: t.created_at,
          relevance: t.title.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch { /* table might not exist */ }
  }

  // Search agents
  if (!typeFilter || typeFilter === 'agent') {
    try {
      const agents = db.prepare(`
        SELECT id, name, role, status, last_activity, created_at
        FROM agents WHERE name LIKE ? OR role LIKE ? OR last_activity LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, likeQ, limit) as any[]
      for (const a of agents) {
        results.push({
          type: 'agent',
          id: a.id,
          title: a.name,
          subtitle: `${a.role} · ${a.status}`,
          excerpt: a.last_activity,
          created_at: a.created_at,
          relevance: a.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch { /* table might not exist */ }
  }

  // Search activities
  if (!typeFilter || typeFilter === 'activity') {
    try {
      const activities = db.prepare(`
        SELECT id, type, actor, description, created_at
        FROM activities WHERE description LIKE ? OR actor LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, limit) as any[]
      for (const a of activities) {
        results.push({
          type: 'activity',
          id: a.id,
          title: a.description,
          subtitle: `by ${a.actor}`,
          created_at: a.created_at,
          relevance: 1,
        })
      }
    } catch { /* table might not exist */ }
  }

  // Search audit log
  if (!typeFilter || typeFilter === 'audit') {
    try {
      const audits = db.prepare(`
        SELECT id, action, actor, detail, created_at
        FROM audit_log WHERE action LIKE ? OR actor LIKE ? OR detail LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, likeQ, limit) as any[]
      for (const a of audits) {
        results.push({
          type: 'audit',
          id: a.id,
          title: a.action,
          subtitle: `by ${a.actor}`,
          excerpt: truncateMatch(a.detail, query),
          created_at: a.created_at,
          relevance: 1,
        })
      }
    } catch { /* table might not exist */ }
  }

  // Search messages
  if (!typeFilter || typeFilter === 'message') {
    try {
      const messages = db.prepare(`
        SELECT id, from_agent, to_agent, content, conversation_id, created_at
        FROM messages WHERE content LIKE ? OR from_agent LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, limit) as any[]
      for (const m of messages) {
        results.push({
          type: 'message',
          id: m.id,
          title: `${m.from_agent} → ${m.to_agent || 'all'}`,
          subtitle: m.conversation_id,
          excerpt: truncateMatch(m.content, query),
          created_at: m.created_at,
          relevance: 1,
        })
      }
    } catch { /* table might not exist */ }
  }

  // Search webhooks
  if (!typeFilter || typeFilter === 'webhook') {
    try {
      const webhooks = db.prepare(`
        SELECT id, name, url, events, created_at
        FROM webhooks WHERE name LIKE ? OR url LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, limit) as any[]
      for (const w of webhooks) {
        results.push({
          type: 'webhook',
          id: w.id,
          title: w.name,
          subtitle: w.url,
          created_at: w.created_at,
          relevance: w.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch { /* table might not exist */ }
  }

  // Search pipelines
  if (!typeFilter || typeFilter === 'pipeline') {
    try {
      const pipelines = db.prepare(`
        SELECT id, name, description, created_at
        FROM workflow_pipelines WHERE name LIKE ? OR description LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, limit) as any[]
      for (const p of pipelines) {
        results.push({
          type: 'pipeline',
          id: p.id,
          title: p.name,
          excerpt: truncateMatch(p.description, query),
          created_at: p.created_at,
          relevance: p.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch { /* table might not exist */ }
  }

  // Sort by relevance then recency
  results.sort((a, b) => b.relevance - a.relevance || b.created_at - a.created_at)

  return NextResponse.json({
    query,
    count: results.length,
    results: results.slice(0, limit),
  })
}

function truncateMatch(text: string | null, query: string, maxLen = 120): string | undefined {
  if (!text) return undefined
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '')
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + query.length + 80)
  const excerpt = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
  return excerpt
}
