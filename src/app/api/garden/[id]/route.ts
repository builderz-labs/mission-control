import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getGardenItem, updateGardenItem, deleteGardenItem } from '@/lib/cc-db';

/**
 * GET /api/garden/[id] - Get a single garden item
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const item = getGardenItem(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/garden/[id] error');
    return NextResponse.json({ error: 'Failed to fetch garden item' }, { status: 500 });
  }
}

/**
 * PUT /api/garden/[id] - Update a garden item
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { id } = await params;
    const body = await request.json();

    const allowed = ['content', 'interest', 'type', 'temporal', 'tags', 'note', 'original_source', 'instance_type'];
    const fields: Record<string, any> = {};
    for (const key of allowed) {
      if (key in body) fields[key] = body[key];
    }

    updateGardenItem(id, fields);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/garden/[id] error');
    return NextResponse.json({ error: 'Failed to update garden item' }, { status: 500 });
  }
}

/**
 * DELETE /api/garden/[id] - Delete a garden item
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { id } = await params;
    deleteGardenItem(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/garden/[id] error');
    return NextResponse.json({ error: 'Failed to delete garden item' }, { status: 500 });
  }
}
