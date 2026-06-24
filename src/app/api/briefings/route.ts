import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { generateAgentBriefing } from '@/lib/briefings';
import { postBriefingToSlack, channelForAgent } from '@/lib/briefing-slack';

/**
 * POST /api/briefings/generate - Generate daily briefing for an agent
 * Body: { agent_name: string, date?: string, post_to_slack?: boolean }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const body = await request.json();
    const workspaceId = auth.user.workspace_id ?? 1;

    const agentName = body.agent_name;
    const targetDate = body.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    if (!agentName) {
      return NextResponse.json({ error: 'agent_name is required' }, { status: 400 });
    }

    const briefing = generateAgentBriefing(db, {
      agentName,
      date: targetDate,
      workspaceId,
      actor: auth.user.username,
    });

    if (!briefing) {
      return NextResponse.json({ error: `Agent ${agentName} not found` }, { status: 404 });
    }

    // Optionally post to the agent's domain Slack channel on demand.
    let slack: { ok: boolean; channel?: string; ts?: string; skipped?: string } | undefined;
    if (body.post_to_slack && channelForAgent(agentName)) {
      slack = await postBriefingToSlack(db, {
        agentName,
        date: briefing.date,
        content: briefing.content,
        workspaceId,
        force: true,
      });
    }

    return NextResponse.json({
      briefing: {
        agent: briefing.agentName,
        date: briefing.date,
        content: briefing.content,
        urgency_items: briefing.urgencyItems,
        calendar_items: briefing.calendarItems,
        metrics: briefing.metrics,
      },
      slack,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/briefings/generate error');
    return NextResponse.json({ error: 'Failed to generate briefing' }, { status: 500 });
  }
}

/**
 * GET /api/briefings - Get briefings history
 * Query: agent_name?, date?, limit?, offset?
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const workspaceId = auth.user.workspace_id ?? 1;

    const agentName = searchParams.get('agent_name');
    const date = searchParams.get('date');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = 'SELECT * FROM briefings WHERE workspace_id = ?';
    const params: any[] = [workspaceId];

    if (agentName) {
      query += ' AND agent_name = ?';
      params.push(agentName);
    }
    if (date) {
      query += ' AND date = ?';
      params.push(date);
    }

    query += ' ORDER BY date DESC, agent_name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const briefings = db.prepare(query).all(...params) as any[];

    const countQuery = 'SELECT COUNT(*) as total FROM briefings WHERE workspace_id = ?' +
      (agentName ? ' AND agent_name = ?' : '') +
      (date ? ' AND date = ?' : '');
    const countParams: any[] = [workspaceId];
    if (agentName) countParams.push(agentName);
    if (date) countParams.push(date);

    const countResult = db.prepare(countQuery).get(...countParams) as { total: number };

    return NextResponse.json({
      briefings: briefings.map(b => ({
        id: b.id,
        agent_name: b.agent_name,
        date: b.date,
        content: b.content,
        urgency_items: b.urgency_items ? JSON.parse(b.urgency_items) : [],
        calendar_items: b.calendar_items ? JSON.parse(b.calendar_items) : [],
        metrics: b.metrics ? JSON.parse(b.metrics) : {},
        posted_at: b.posted_at,
        created_at: b.created_at
      })),
      total: countResult.total,
      page: Math.floor(offset / limit) + 1,
      limit
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/briefings error');
    return NextResponse.json({ error: 'Failed to fetch briefings' }, { status: 500 });
  }
}
