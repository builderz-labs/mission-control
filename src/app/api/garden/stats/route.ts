import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getGardenStats } from '@/lib/cc-db';

/**
 * GET /api/garden/stats - Aggregate counts by interest and type
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const stats = getGardenStats();
    return NextResponse.json(stats);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/garden/stats error');
    return NextResponse.json({ error: 'Failed to fetch garden stats' }, { status: 500 });
  }
}
