import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getGardenItems, type GardenFilters } from '@/lib/cc-db';

/**
 * GET /api/garden - List garden items with filters
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);

    const filters: GardenFilters = {};
    if (searchParams.get('interest')) filters.interest = searchParams.get('interest')!;
    if (searchParams.get('type')) filters.type = searchParams.get('type')!;
    if (searchParams.get('temporal')) filters.temporal = searchParams.get('temporal')!;
    if (searchParams.get('search')) filters.search = searchParams.get('search')!;
    filters.limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    filters.offset = parseInt(searchParams.get('offset') || '0');

    const result = getGardenItems(filters);

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/garden error');
    return NextResponse.json({ error: 'Failed to fetch garden items' }, { status: 500 });
  }
}
