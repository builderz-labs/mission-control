import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getTweets, type TweetFilters } from '@/lib/cc-db';

/**
 * GET /api/xfeed - List tweets with filters
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);

    const filters: TweetFilters = {};
    if (searchParams.get('theme')) filters.theme = searchParams.get('theme')!;
    if (searchParams.get('rating')) filters.rating = searchParams.get('rating')!;
    if (searchParams.get('digest')) filters.digest = searchParams.get('digest')!;
    if (searchParams.get('pinned') === 'true') filters.pinned = true;
    if (searchParams.get('search')) filters.search = searchParams.get('search')!;
    filters.limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    filters.offset = parseInt(searchParams.get('offset') || '0');

    const result = getTweets(filters);

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/xfeed error');
    return NextResponse.json({ error: 'Failed to fetch tweets' }, { status: 500 });
  }
}
