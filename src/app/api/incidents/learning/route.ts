import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { learnRules, getLearningDashboard } from '@/lib/incident-learning';

/**
 * GET /api/incidents/learning
 * Returns learned rules, prediction accuracy, intervention effectiveness, and a
 * summary for the learning dashboard.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    return NextResponse.json(getLearningDashboard(db, workspaceId));
  } catch (error) {
    logger.error({ err: error }, 'GET /api/incidents/learning error');
    return NextResponse.json({ error: 'Failed to fetch learning data' }, { status: 500 });
  }
}

/**
 * POST /api/incidents/learning
 * Body: { action: 'run' } -> run a learn pass (aggregate outcomes -> rules)
 *       { action: 'arm' | 'reject' | 'shadow', rule_id } -> manual rule status
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'run';

    if (action === 'run') {
      const stats = learnRules(db, workspaceId);
      db_helpers.logActivity(
        'incident_learning_run', 'incident', 0, auth.user.username,
        `Ran incident learning pass: ${stats.armed} armed, ${stats.shadow} shadow rules from ${stats.outcomes} outcomes`,
        stats, workspaceId,
      );
      return NextResponse.json({ ok: true, stats });
    }

    if (action === 'arm' || action === 'reject' || action === 'shadow') {
      const ruleId = Number(body.rule_id);
      if (!ruleId) return NextResponse.json({ error: 'rule_id required' }, { status: 400 });
      const status = action === 'arm' ? 'armed' : action === 'reject' ? 'rejected' : 'shadow';
      const res = db.prepare(
        `UPDATE learned_scoring_rules
            SET status = ?, status_source = 'manual', updated_at = unixepoch()
          WHERE id = ? AND workspace_id = ?`,
      ).run(status, ruleId, workspaceId);
      if (res.changes === 0) return NextResponse.json({ error: 'rule not found' }, { status: 404 });
      db_helpers.logActivity(
        'incident_rule_status', 'incident', ruleId, auth.user.username,
        `Set learned rule #${ruleId} to ${status}`, { status }, workspaceId,
      );
      return NextResponse.json({ ok: true, rule_id: ruleId, status });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/incidents/learning error');
    return NextResponse.json({ error: 'Failed to run learning action' }, { status: 500 });
  }
}
