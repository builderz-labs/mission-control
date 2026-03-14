import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { getDatabase, Agent } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

interface TaskStatsRow { total: number; completed: number; active: number }
interface CountRow { c: number }
interface ActivityRow { id: number; type: string; entity_type: string; entity_id: number; description: string; data: string | null; created_at: number }
interface AuditLogRow { id: number; action: string; actor: string; detail: string | null; created_at: number }
interface TaskMutationRow { id: number; type: string; entity_type: string; entity_id: number; description: string; data: string | null; created_at: number }
interface CommentRow { id: number; task_id: number; content: string; created_at: number; mentions: string | null; task_title: string | null }
interface StatusChangeRow { id: number; type: string; description: string; data: string | null; created_at: number }
interface DailyTokenRow { day_bucket: number; input_tokens: number; output_tokens: number; requests: number }

const ALLOWED_SECTIONS = new Set(['identity', 'audit', 'mutations', 'cost']);

/**
 * GET /api/agents/[id]/attribution - Agent-Level Identity & Attribution
 *
 * Returns a comprehensive audit trail and cost attribution report for
 * a specific agent. Enables per-agent observability, debugging, and
 * cost analysis in multi-agent environments.
 *
 * Query params:
 *   hours   - Time window (default: 24, max: 720)
 *   section - Comma-separated: audit,cost,mutations,identity (default: all)
 *
 * Response:
 *   identity   - Agent profile, status, and session info
 *   audit      - Full audit trail of agent actions
 *   mutations  - Task/memory/soul changes attributed to this agent
 *   cost       - Token usage and cost breakdown per model
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const workspaceId = auth.user.workspace_id ?? 1;

    // Resolve agent
    let agent: Agent | undefined;
    if (/^\d+$/.test(agentId)) {
      agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId) as Agent | undefined;
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId) as Agent | undefined;
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const privileged = searchParams.get('privileged') === '1';
    const isSelfByHeader = auth.user.agent_name === agent.name;
    const isSelfByUsername = auth.user.username === agent.name;
    const isSelf = isSelfByHeader || isSelfByUsername;
    const isPrivileged = auth.user.role === 'admin' && privileged;
    if (!isSelf && !isPrivileged) {
      return NextResponse.json(
        { error: 'Forbidden: attribution is self-scope by default. Admin can use ?privileged=1 override.' },
        { status: 403 }
      );
    }

    const hoursRaw = searchParams.get('hours');
    const hours = parseHours(hoursRaw);
    if (!hours) {
      return NextResponse.json({ error: 'Invalid hours. Expected integer 1..720.' }, { status: 400 });
    }

    const sections = parseSections(searchParams.get('section'));
    if ('error' in sections) {
      return NextResponse.json({ error: sections.error }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    const since = now - hours * 3600;

    const result: Record<string, any> = {
      agent_name: agent.name,
      timeframe: { hours, since, until: now },
      access_scope: isSelf ? 'self' : 'privileged',
    };

    if (sections.sections.has('identity')) {
      result.identity = buildIdentity(db, agent, workspaceId);
    }

    if (sections.sections.has('audit')) {
      result.audit = buildAuditTrail(db, agent.name, workspaceId, since);
    }

    if (sections.sections.has('mutations')) {
      result.mutations = buildMutations(db, agent.name, workspaceId, since);
    }

    if (sections.sections.has('cost')) {
      result.cost = buildCostAttribution(db, agent.name, workspaceId, since);
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/attribution error');
    return NextResponse.json({ error: 'Failed to fetch attribution data' }, { status: 500 });
  }
}

/** Agent identity and profile info */
function buildIdentity(db: Database.Database, agent: Agent, workspaceId: number) {
  const config = safeParseJson(agent.config ?? null, {});

  // Count total tasks ever assigned
  const taskStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) as active
    FROM tasks WHERE assigned_to = ? AND workspace_id = ?
  `).get(agent.name, workspaceId) as TaskStatsRow | undefined;

  // Count comments authored
  const commentCount = (db.prepare(
    `SELECT COUNT(*) as c FROM comments WHERE author = ? AND workspace_id = ?`
  ).get(agent.name, workspaceId) as CountRow).c;

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    last_seen: agent.last_seen,
    last_activity: agent.last_activity,
    created_at: agent.created_at,
    session_key: agent.session_key ? '***' : null, // Masked for security
    has_soul: !!agent.soul_content,
    config_keys: Object.keys(config),
    lifetime_stats: {
      tasks_total: taskStats?.total || 0,
      tasks_completed: taskStats?.completed || 0,
      tasks_active: taskStats?.active || 0,
      comments_authored: commentCount,
    },
  };
}

/** Audit trail — all activities attributed to this agent */
function buildAuditTrail(db: Database.Database, agentName: string, workspaceId: number, since: number) {
  // Activities where this agent is the actor
  const activities = db.prepare(`
    SELECT id, type, entity_type, entity_id, description, data, created_at
    FROM activities
    WHERE actor = ? AND workspace_id = ? AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(agentName, workspaceId, since) as ActivityRow[];

  // Audit log entries (system-wide, may reference agent)
  let auditEntries: AuditLogRow[] = [];
  try {
    auditEntries = db.prepare(`
      SELECT id, action, actor, detail, created_at
      FROM audit_log
      WHERE (actor = ? OR detail LIKE ?) AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(agentName, `%${agentName}%`, since) as AuditLogRow[];
  } catch {
    // audit_log table may not exist
  }

  // Group activities by type for summary
  const byType: Record<string, number> = {};
  for (const a of activities) {
    byType[a.type] = (byType[a.type] || 0) + 1;
  }

  return {
    total_activities: activities.length,
    by_type: byType,
    activities: activities.map(a => ({
      ...a,
      data: safeParseJson(a.data, null),
    })),
    audit_log_entries: auditEntries.map(e => ({
      ...e,
      detail: safeParseJson(e.detail, null),
    })),
  };
}

/** Mutations — task changes, comments, status transitions */
function buildMutations(db: Database.Database, agentName: string, workspaceId: number, since: number) {
  // Task mutations (created, updated, status changes)
  const taskMutations = db.prepare(`
    SELECT id, type, entity_type, entity_id, description, data, created_at
    FROM activities
    WHERE actor = ? AND workspace_id = ? AND created_at >= ?
      AND entity_type = 'task'
      AND type IN ('task_created', 'task_updated', 'task_status_change', 'task_assigned')
    ORDER BY created_at DESC
    LIMIT 100
  `).all(agentName, workspaceId, since) as TaskMutationRow[];

  // Comments authored
  const comments = db.prepare(`
    SELECT c.id, c.task_id, c.content, c.created_at, c.mentions, t.title as task_title
    FROM comments c
    LEFT JOIN tasks t ON c.task_id = t.id AND t.workspace_id = ?
    WHERE c.author = ? AND c.workspace_id = ? AND c.created_at >= ?
    ORDER BY c.created_at DESC
    LIMIT 50
  `).all(workspaceId, agentName, workspaceId, since) as CommentRow[];

  // Agent status changes (by heartbeat or others)
  const statusChanges = db.prepare(`
    SELECT id, type, description, data, created_at
    FROM activities
    WHERE entity_type = 'agent' AND workspace_id = ?
      AND created_at >= ?
      AND (actor = ? OR description LIKE ?)
    ORDER BY created_at DESC
    LIMIT 50
  `).all(workspaceId, since, agentName, `%${agentName}%`) as StatusChangeRow[];

  return {
    task_mutations: taskMutations.map(m => ({
      ...m,
      data: safeParseJson(m.data, null),
    })),
    comments: comments.map(c => ({
      ...c,
      mentions: safeParseJson(c.mentions, []),
      content_preview: c.content?.substring(0, 200) || '',
    })),
    status_changes: statusChanges.map(s => ({
      ...s,
      data: safeParseJson(s.data, null),
    })),
    summary: {
      task_mutations_count: taskMutations.length,
      comments_count: comments.length,
      status_changes_count: statusChanges.length,
    },
  };
}

/** Cost attribution — token usage per model */
function buildCostAttribution(db: Database.Database, agentName: string, workspaceId: number, since: number) {
  try {
    const byModel = db.prepare(`
      SELECT model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM token_usage
      WHERE session_id = ? AND workspace_id = ? AND created_at >= ?
      GROUP BY model
      ORDER BY (input_tokens + output_tokens) DESC
    `).all(agentName, workspaceId, since) as Array<{
      model: string; request_count: number; input_tokens: number; output_tokens: number
    }>;

    // Also check session IDs that contain the agent name (e.g. "agentname:cli")
    const byModelAlt = db.prepare(`
      SELECT model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM token_usage
      WHERE session_id LIKE ? AND session_id != ? AND workspace_id = ? AND created_at >= ?
      GROUP BY model
      ORDER BY (input_tokens + output_tokens) DESC
    `).all(`${agentName}:%`, agentName, workspaceId, since) as Array<{
      model: string; request_count: number; input_tokens: number; output_tokens: number
    }>;

    // Merge results
    const merged = new Map<string, { model: string; request_count: number; input_tokens: number; output_tokens: number }>();
    for (const row of [...byModel, ...byModelAlt]) {
      const existing = merged.get(row.model);
      if (existing) {
        existing.request_count += row.request_count;
        existing.input_tokens += row.input_tokens;
        existing.output_tokens += row.output_tokens;
      } else {
        merged.set(row.model, { ...row });
      }
    }

    const models = Array.from(merged.values());
    const total = models.reduce((acc, r) => ({
      input_tokens: acc.input_tokens + r.input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
      requests: acc.requests + r.request_count,
    }), { input_tokens: 0, output_tokens: 0, requests: 0 });

    // Daily breakdown for trend
    const daily = db.prepare(`
      SELECT (created_at / 86400) * 86400 as day_bucket,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        COUNT(*) as requests
      FROM token_usage
      WHERE (session_id = ? OR session_id LIKE ?) AND workspace_id = ? AND created_at >= ?
      GROUP BY day_bucket
      ORDER BY day_bucket ASC
    `).all(agentName, `${agentName}:%`, workspaceId, since) as DailyTokenRow[];

    return {
      by_model: models,
      total,
      daily_trend: daily.map(d => ({
        date: new Date(d.day_bucket * 1000).toISOString().split('T')[0],
        ...d,
      })),
    };
  } catch {
    return { by_model: [], total: { input_tokens: 0, output_tokens: 0, requests: 0 }, daily_trend: [] };
  }
}

function parseHours(hoursRaw: string | null): number | null {
  if (!hoursRaw || hoursRaw.trim() === '') return 24;
  if (!/^\d+$/.test(hoursRaw)) return null;
  const hours = Number(hoursRaw);
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) return null;
  return hours;
}

function parseSections(
  sectionRaw: string | null
): { sections: Set<string> } | { error: string } {
  const value = (sectionRaw || 'identity,audit,mutations,cost').trim();
  const parsed = value
    .split(',')
    .map((section) => section.trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    return { error: 'Invalid section. Expected one or more of identity,audit,mutations,cost.' };
  }

  const invalid = parsed.filter((section) => !ALLOWED_SECTIONS.has(section));
  if (invalid.length > 0) {
    return { error: `Invalid section value(s): ${invalid.join(', ')}` };
  }

  return { sections: new Set(parsed) };
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
