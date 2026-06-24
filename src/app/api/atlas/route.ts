import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getAtlasDashboard, runReflectionForWorkspace, measureExperiments, weekStart } from '@/lib/atlas-reflection';

/**
 * GET /api/atlas
 * Atlas self-improvement dashboard: weekly reflections, coordination rules,
 * experiments in flight, and a summary.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    return NextResponse.json(getAtlasDashboard(db, workspaceId));
  } catch (error) {
    logger.error({ err: error }, 'GET /api/atlas error');
    return NextResponse.json({ error: 'Failed to fetch Atlas dashboard' }, { status: 500 });
  }
}

/**
 * POST /api/atlas
 * Body:
 *   { action: 'reflect', week_of? }                       -> run a weekly reflection now
 *   { action: 'measure', week_of? }                       -> re-score experiments now
 *   { action: 'arm'|'shadow'|'reject'|'retire', rule_id } -> set rule status (manual)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'reflect';

    if (action === 'reflect') {
      const result = await runReflectionForWorkspace(db, {
        weekOf: body.week_of || undefined,
        workspaceId,
        actor: auth.user.username,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (action === 'measure') {
      const weekOf = body.week_of || weekStart(Date.now());
      const stats = measureExperiments(db, weekOf, workspaceId);
      db_helpers.logActivity(
        'atlas_measure', 'agent', 0, auth.user.username,
        `Atlas measured experiments (${weekOf}): ${stats.armed} armed, ${stats.retired} retired, ${stats.improved} improved`,
        stats, workspaceId,
      );
      return NextResponse.json({ ok: true, week_of: weekOf, stats });
    }

    if (action === 'arm' || action === 'reject' || action === 'shadow' || action === 'retire') {
      const ruleId = Number(body.rule_id);
      if (!ruleId) return NextResponse.json({ error: 'rule_id required' }, { status: 400 });
      const status = action === 'arm' ? 'armed' : action === 'reject' ? 'rejected' : action === 'retire' ? 'retired' : 'shadow';
      const res = db.prepare(
        `UPDATE atlas_coordination_rules
            SET status = ?, status_source = 'manual', updated_at = unixepoch()
          WHERE id = ? AND workspace_id = ?`,
      ).run(status, ruleId, workspaceId);
      if (res.changes === 0) return NextResponse.json({ error: 'rule not found' }, { status: 404 });
      db_helpers.logActivity(
        'atlas_rule_status', 'agent', ruleId, auth.user.username,
        `Set Atlas coordination rule #${ruleId} to ${status}`, { status }, workspaceId,
      );
      return NextResponse.json({ ok: true, rule_id: ruleId, status });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/atlas error');
    return NextResponse.json({ error: 'Failed to run Atlas action' }, { status: 500 });
  }
}
