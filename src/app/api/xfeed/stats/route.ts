import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getTweetStats } from '@/lib/cc-db';

/**
 * GET /api/xfeed/stats - Dashboard stats for tweets
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const stats = getTweetStats();
    return NextResponse.json(stats);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/xfeed/stats error');
    return NextResponse.json({ error: 'Failed to fetch tweet stats' }, { status: 500 });
  }
}
