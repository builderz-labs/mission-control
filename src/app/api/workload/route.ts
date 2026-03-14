import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * GET /api/workload - Real-Time Workload Signals
 *
 * Provides system-wide capacity metrics and throttle recommendations
 * so agents can make informed decisions about work submission.
 *
 * Response:
 *   capacity    - Current system capacity metrics
 *   queue       - Task queue depth and breakdown
 *   agents      - Agent availability and load distribution
 *   recommendation - Actionable signal: normal | throttle | shed | pause
 *   thresholds  - Current threshold configuration
 *
 * Agents should call this before submitting new work to avoid
 * cascading failures and SLO breaches.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const now = Math.floor(Date.now() / 1000);

    // --- Capacity metrics ---
    const capacity = buildCapacityMetrics(db, workspaceId, now);

    // --- Queue depth ---
    const queue = buildQueueMetrics(db, workspaceId);

    // --- Agent availability ---
    const agents = buildAgentMetrics(db, workspaceId, now);

    // --- Recommendation ---
    const recommendation = computeRecommendation(capacity, queue, agents);

    return NextResponse.json({
      timestamp: now,
      workspace_id: workspaceId,
      capacity,
      queue,
      agents,
      recommendation,
      thresholds: THRESHOLDS,
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workload error');
    return NextResponse.json({ error: 'Failed to fetch workload signals' }, { status: 500 });
  }
}

// Configurable thresholds for recommendation engine
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildThresholds() {
  return {
    queue_depth_normal: numEnv('MC_WORKLOAD_QUEUE_DEPTH_NORMAL', 20),
    queue_depth_throttle: numEnv('MC_WORKLOAD_QUEUE_DEPTH_THROTTLE', 50),
    queue_depth_shed: numEnv('MC_WORKLOAD_QUEUE_DEPTH_SHED', 100),
    busy_agent_ratio_throttle: numEnv('MC_WORKLOAD_BUSY_RATIO_THROTTLE', 0.8),
    busy_agent_ratio_shed: numEnv('MC_WORKLOAD_BUSY_RATIO_SHED', 0.95),
    error_rate_throttle: numEnv('MC_WORKLOAD_ERROR_RATE_THROTTLE', 0.1),
    error_rate_shed: numEnv('MC_WORKLOAD_ERROR_RATE_SHED', 0.25),
    recent_window_seconds: Math.max(1, Math.floor(numEnv('MC_WORKLOAD_RECENT_WINDOW_SECONDS', 300))),
  };
}

const THRESHOLDS = buildThresholds();

interface CapacityMetrics {
  active_tasks: number;
  tasks_last_5m: number;
  errors_last_5m: number;
  error_rate_5m: number;
  completions_last_hour: number;
  avg_completion_rate_per_hour: number;
}

interface QueueMetrics {
  total_pending: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  oldest_pending_age_seconds: number | null;
  estimated_wait_seconds: number | null;
  estimated_wait_confidence: 'calculated' | 'unknown';
}

interface AgentMetrics {
  total: number;
  online: number;
  busy: number;
  idle: number;
  offline: number;
  busy_ratio: number;
  load_distribution: Array<{ agent: string; assigned: number; in_progress: number }>;
}

function buildCapacityMetrics(db: any, workspaceId: number, now: number): CapacityMetrics {
  const recentWindow = now - THRESHOLDS.recent_window_seconds;
  const hourAgo = now - 3600;

  const activeTasks = (db.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND status IN ('assigned', 'in_progress', 'review', 'quality_review')`
  ).get(workspaceId) as { c: number }).c;

  const tasksLast5m = (db.prepare(
    `SELECT COUNT(*) as c FROM activities WHERE workspace_id = ? AND created_at >= ? AND type IN ('task_created', 'task_assigned')`
  ).get(workspaceId, recentWindow) as { c: number }).c;

  const errorsLast5m = (db.prepare(
    `SELECT COUNT(*) as c FROM activities WHERE workspace_id = ? AND created_at >= ? AND (type LIKE '%error%' OR type LIKE '%fail%')`
  ).get(workspaceId, recentWindow) as { c: number }).c;

  const totalLast5m = (db.prepare(
    `SELECT COUNT(*) as c FROM activities WHERE workspace_id = ? AND created_at >= ?`
  ).get(workspaceId, recentWindow) as { c: number }).c;

  const completionsLastHour = (db.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND status = 'done' AND updated_at >= ?`
  ).get(workspaceId, hourAgo) as { c: number }).c;

  // Average completion rate over last 24h
  const dayAgo = now - 86400;
  const completionsLastDay = (db.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND status = 'done' AND updated_at >= ?`
  ).get(workspaceId, dayAgo) as { c: number }).c;

  const safeErrorRate = totalLast5m > 0 ? errorsLast5m / totalLast5m : 0;

  return {
    active_tasks: activeTasks,
    tasks_last_5m: tasksLast5m,
    errors_last_5m: errorsLast5m,
    error_rate_5m: Math.max(0, Math.min(1, Math.round(safeErrorRate * 10000) / 10000)),
    completions_last_hour: completionsLastHour,
    avg_completion_rate_per_hour: Math.round((completionsLastDay / 24) * 100) / 100,
  };
}

function buildQueueMetrics(db: any, workspaceId: number): QueueMetrics {
  const now = Math.floor(Date.now() / 1000);

  const pendingStatuses = ['inbox', 'assigned', 'in_progress', 'review', 'quality_review'];

  const byStatus = db.prepare(
    `SELECT status, COUNT(*) as count FROM tasks WHERE workspace_id = ? AND status IN (${pendingStatuses.map(() => '?').join(',')}) GROUP BY status`
  ).all(workspaceId, ...pendingStatuses) as Array<{ status: string; count: number }>;

  const byPriority = db.prepare(
    `SELECT priority, COUNT(*) as count FROM tasks WHERE workspace_id = ? AND status IN (${pendingStatuses.map(() => '?').join(',')}) GROUP BY priority`
  ).all(workspaceId, ...pendingStatuses) as Array<{ priority: string; count: number }>;

  const totalPending = byStatus.reduce((sum, r) => sum + r.count, 0);

  const oldest = db.prepare(
    `SELECT MIN(created_at) as oldest FROM tasks WHERE workspace_id = ? AND status IN ('inbox', 'assigned')`
  ).get(workspaceId) as { oldest: number | null } | undefined;

  const oldestAge = oldest?.oldest ? now - oldest.oldest : null;

  // Estimate wait: pending tasks / completion rate per hour * 3600
  const hourAgo = now - 3600;
  const completionsLastHour = (db.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND status = 'done' AND updated_at >= ?`
  ).get(workspaceId, hourAgo) as { c: number }).c;

  const estimatedWait = completionsLastHour > 0
    ? Math.round((totalPending / completionsLastHour) * 3600)
    : null;

  const statusMap = Object.fromEntries(byStatus.map(r => [r.status, r.count]));
  for (const status of pendingStatuses) {
    if (typeof statusMap[status] !== 'number') statusMap[status] = 0;
  }

  const priorityMap = Object.fromEntries(byPriority.map(r => [r.priority, r.count]));
  for (const priority of ['low', 'medium', 'high', 'critical', 'urgent']) {
    if (typeof priorityMap[priority] !== 'number') priorityMap[priority] = 0;
  }

  return {
    total_pending: totalPending,
    by_status: statusMap,
    by_priority: priorityMap,
    oldest_pending_age_seconds: oldestAge,
    estimated_wait_seconds: estimatedWait,
    estimated_wait_confidence: estimatedWait === null ? 'unknown' : 'calculated',
  };
}

function buildAgentMetrics(db: any, workspaceId: number, now: number): AgentMetrics {
  const agentStatuses = db.prepare(
    `SELECT status, COUNT(*) as count FROM agents WHERE workspace_id = ? GROUP BY status`
  ).all(workspaceId) as Array<{ status: string; count: number }>;

  const statusMap: Record<string, number> = {};
  let total = 0;
  for (const row of agentStatuses) {
    statusMap[row.status] = row.count;
    total += row.count;
  }

  const online = (statusMap['idle'] || 0) + (statusMap['busy'] || 0);
  const busy = statusMap['busy'] || 0;
  const idle = statusMap['idle'] || 0;
  const offline = statusMap['offline'] || 0;

  // Load distribution per agent
  const loadDist = db.prepare(`
    SELECT a.name as agent,
      SUM(CASE WHEN t.status = 'assigned' THEN 1 ELSE 0 END) as assigned,
      SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress
    FROM agents a
    LEFT JOIN tasks t ON t.assigned_to = a.name AND t.workspace_id = a.workspace_id AND t.status IN ('assigned', 'in_progress')
    WHERE a.workspace_id = ? AND a.status != 'offline'
    GROUP BY a.name
    ORDER BY (assigned + in_progress) DESC
  `).all(workspaceId) as Array<{ agent: string; assigned: number; in_progress: number }>;

  return {
    total,
    online,
    busy,
    idle,
    offline,
    busy_ratio: online > 0 ? Math.round((busy / online) * 100) / 100 : 0,
    load_distribution: loadDist,
  };
}

type RecommendationLevel = 'normal' | 'throttle' | 'shed' | 'pause';

interface Recommendation {
  action: RecommendationLevel;
  reason: string;
  details: string[];
  submit_ok: boolean;
  suggested_delay_ms: number;
}

function computeRecommendation(
  capacity: CapacityMetrics,
  queue: QueueMetrics,
  agents: AgentMetrics
): Recommendation {
  const reasons: string[] = [];
  let level: RecommendationLevel = 'normal';

  // Check error rate
  if (capacity.error_rate_5m >= THRESHOLDS.error_rate_shed) {
    level = escalate(level, 'shed');
    reasons.push(`High error rate: ${(capacity.error_rate_5m * 100).toFixed(1)}%`);
  } else if (capacity.error_rate_5m >= THRESHOLDS.error_rate_throttle) {
    level = escalate(level, 'throttle');
    reasons.push(`Elevated error rate: ${(capacity.error_rate_5m * 100).toFixed(1)}%`);
  }

  // Check queue depth
  if (queue.total_pending >= THRESHOLDS.queue_depth_shed) {
    level = escalate(level, 'shed');
    reasons.push(`Queue depth critical: ${queue.total_pending} pending tasks`);
  } else if (queue.total_pending >= THRESHOLDS.queue_depth_throttle) {
    level = escalate(level, 'throttle');
    reasons.push(`Queue depth high: ${queue.total_pending} pending tasks`);
  }

  // Check agent saturation
  if (agents.busy_ratio >= THRESHOLDS.busy_agent_ratio_shed) {
    level = escalate(level, 'shed');
    reasons.push(`Agent saturation critical: ${(agents.busy_ratio * 100).toFixed(0)}% busy`);
  } else if (agents.busy_ratio >= THRESHOLDS.busy_agent_ratio_throttle) {
    level = escalate(level, 'throttle');
    reasons.push(`Agent saturation high: ${(agents.busy_ratio * 100).toFixed(0)}% busy`);
  }

  // No online agents = pause
  if (agents.online === 0) {
    level = 'pause';
    reasons.push(agents.total > 0 ? 'No agents online' : 'No agents registered');
  }

  const delayMap: Record<RecommendationLevel, number> = {
    normal: 0,
    throttle: 2000,
    shed: 10000,
    pause: 30000,
  };

  const actionDescriptions: Record<RecommendationLevel, string> = {
    normal: 'System healthy — submit work freely',
    throttle: 'System under load — reduce submission rate and defer non-critical work',
    shed: 'System overloaded — submit only critical/high-priority work, defer everything else',
    pause: 'System unavailable — hold all submissions until capacity returns',
  };

  return {
    action: level,
    reason: actionDescriptions[level],
    details: reasons.length > 0 ? reasons : ['All metrics within normal bounds'],
    submit_ok: level === 'normal' || level === 'throttle',
    suggested_delay_ms: delayMap[level],
  };
}

function escalate(current: RecommendationLevel, proposed: RecommendationLevel): RecommendationLevel {
  const order: RecommendationLevel[] = ['normal', 'throttle', 'shed', 'pause'];
  return order.indexOf(proposed) > order.indexOf(current) ? proposed : current;
}
