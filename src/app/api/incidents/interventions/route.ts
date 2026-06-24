import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * GET /api/incidents/interventions?property_id=&category=
 * Returns recorded interventions (which fix was tried + whether it worked).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const { searchParams } = new URL(request.url);
    let query = 'SELECT * FROM intervention_outcomes WHERE workspace_id = ?';
    const params: any[] = [workspaceId];
    const propertyId = searchParams.get('property_id');
    const category = searchParams.get('category');
    if (propertyId) { query += ' AND property_id = ?'; params.push(propertyId); }
    if (category) { query += ' AND category = ?'; params.push(category); }
    query += ' ORDER BY created_at DESC LIMIT 200';
    return NextResponse.json({ interventions: db.prepare(query).all(...params) });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/incidents/interventions error');
    return NextResponse.json({ error: 'Failed to fetch interventions' }, { status: 500 });
  }
}

/**
 * POST /api/incidents/interventions
 * Record which intervention was tried on an incident and whether it worked.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json();
    const {
      incident_id, property_id, category, intervention_type, description,
      success, recurred, resolution_hours, cost, notes,
    } = body;

    if (!intervention_type || !property_id) {
      return NextResponse.json({ error: 'property_id and intervention_type are required' }, { status: 400 });
    }

    const result = db.prepare(
      `INSERT INTO intervention_outcomes
         (incident_id, property_id, category, intervention_type, description,
          success, recurred, resolution_hours, cost, notes, created_by, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      incident_id ?? null, property_id, category ?? null, intervention_type, description ?? null,
      success != null ? (success ? 1 : 0) : null, recurred ? 1 : 0,
      resolution_hours ?? null, cost ?? null, notes ?? null, auth.user.username, workspaceId,
    );

    db_helpers.logActivity(
      'intervention_recorded', 'incident', incident_id ?? 0, auth.user.username,
      `Recorded intervention "${intervention_type}" at ${property_id} (${success ? 'worked' : 'did not work'})`,
      { intervention_type, success }, workspaceId,
    );

    return NextResponse.json({ intervention: { id: result.lastInsertRowid, ...body } });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/incidents/interventions error');
    return NextResponse.json({ error: 'Failed to record intervention' }, { status: 500 });
  }
}
