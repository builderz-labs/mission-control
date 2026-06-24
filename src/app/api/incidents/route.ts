import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/incidents - Create or update an incident
 * Body: incident data (property_id, date, title, category, severity, etc.)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const body = await request.json();
    const workspaceId = auth.user.workspace_id ?? 1;

    const {
      property_id,
      date,
      title,
      description,
      category,
      severity,
      status,
      reported_by,
      assigned_to,
      resolved_date,
      task_id,
      cost,
      cost_vendor,
      cost_date,
      cost_category,
      guest_mentions,
      guest_sentiment,
      review_keywords,
      guest_impact_score,
      validated_by,
      conflicts,
      briefing_dates
    } = body;

    if (!property_id || !date || !title) {
      return NextResponse.json(
        { error: 'property_id, date, and title are required' },
        { status: 400 }
      );
    }

    const now = Math.floor(Date.now() / 1000);

    // Check if incident exists
    const existing = db.prepare(`
      SELECT id FROM property_incidents
      WHERE property_id = ? AND date = ? AND title = ? AND workspace_id = ?
    `).get(property_id, date, title, workspaceId) as any;

    if (existing) {
      // Update existing
      db.prepare(`
        UPDATE property_incidents SET
          description = ?, category = ?, severity = ?, status = ?,
          reported_by = ?, assigned_to = ?, resolved_date = ?,
          task_id = ?, cost = ?, cost_vendor = ?, cost_date = ?,
          cost_category = ?, guest_mentions = ?, guest_sentiment = ?,
          review_keywords = ?, guest_impact_score = ?,
          validated_by = ?, conflicts = ?, briefing_dates = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        description, category, severity, status,
        reported_by, assigned_to, resolved_date,
        task_id, cost, cost_vendor, cost_date,
        cost_category, guest_mentions, guest_sentiment,
        review_keywords, guest_impact_score,
        JSON.stringify(validated_by),
        conflicts,
        JSON.stringify(briefing_dates),
        now,
        existing.id
      );

      db_helpers.logActivity(
        'incident_updated',
        'incident',
        existing.id,
        auth.user.username,
        `Updated incident: ${title} at ${property_id}`,
        { property_id, category, severity },
        workspaceId
      );

      return NextResponse.json({ incident: { id: existing.id, ...body } });
    } else {
      // Create new
      const result = db.prepare(`
        INSERT INTO property_incidents (
          property_id, date, title, description, category, severity, status,
          reported_by, assigned_to, resolved_date, task_id,
          cost, cost_vendor, cost_date, cost_category,
          guest_mentions, guest_sentiment, review_keywords, guest_impact_score,
          validated_by, conflicts, briefing_dates,
          created_at, updated_at, workspace_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        property_id, date, title, description, category, severity, status,
        reported_by, assigned_to, resolved_date, task_id,
        cost, cost_vendor, cost_date, cost_category,
        guest_mentions, guest_sentiment, JSON.stringify(review_keywords), guest_impact_score,
        JSON.stringify(validated_by), conflicts, JSON.stringify(briefing_dates),
        now, now, workspaceId
      );

      db_helpers.logActivity(
        'incident_created',
        'incident',
        result.lastInsertRowid as number,
        auth.user.username,
        `Created incident: ${title} at ${property_id}`,
        { property_id, category, severity },
        workspaceId
      );

      return NextResponse.json({ incident: { id: result.lastInsertRowid, ...body } });
    }
  } catch (error) {
    logger.error({ err: error }, 'POST /api/incidents error');
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
  }
}

/**
 * GET /api/incidents - Fetch incidents
 * Query: property_id?, date?, status?, severity?, category?, limit?, offset?
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const workspaceId = auth.user.workspace_id ?? 1;

    const propertyId = searchParams.get('property_id');
    const date = searchParams.get('date');
    const status = searchParams.get('status');
    const severity = searchParams.get('severity');
    const category = searchParams.get('category');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = 'SELECT * FROM property_incidents WHERE workspace_id = ?';
    const params: any[] = [workspaceId];

    if (propertyId) {
      query += ' AND property_id = ?';
      params.push(propertyId);
    }
    if (date) {
      query += ' AND date = ?';
      params.push(date);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY date DESC, property_id ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const incidents = db.prepare(query).all(...params) as any[];

    // Count total
    let countQuery = 'SELECT COUNT(*) as total FROM property_incidents WHERE workspace_id = ?';
    const countParams: any[] = [workspaceId];
    if (propertyId) {
      countQuery += ' AND property_id = ?';
      countParams.push(propertyId);
    }
    if (date) {
      countQuery += ' AND date = ?';
      countParams.push(date);
    }
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    if (severity) {
      countQuery += ' AND severity = ?';
      countParams.push(severity);
    }
    if (category) {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }

    const countResult = db.prepare(countQuery).get(...countParams) as { total: number };

    return NextResponse.json({
      incidents: incidents.map(i => ({
        ...i,
        review_keywords: i.review_keywords ? JSON.parse(i.review_keywords) : [],
        validated_by: i.validated_by ? JSON.parse(i.validated_by) : [],
        briefing_dates: i.briefing_dates ? JSON.parse(i.briefing_dates) : []
      })),
      total: countResult.total,
      page: Math.floor(offset / limit) + 1,
      limit
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/incidents error');
    return NextResponse.json({ error: 'Failed to fetch incidents' }, { status: 500 });
  }
}
