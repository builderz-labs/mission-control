import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { rateTweet, pinTweet, triageUpdate } from '@/lib/cc-db';

/**
 * PUT /api/xfeed/[id] - Rate, pin, or triage a tweet
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

    if ('rating' in body) {
      const { rating } = body;
      if (rating !== null && !['fire', 'meh', 'noise'].includes(rating)) {
        return NextResponse.json({ error: 'Invalid rating' }, { status: 400 });
      }
      rateTweet(id, rating);
    }

    if ('pinned' in body) {
      pinTweet(id, !!body.pinned);
    }

    if ('triage_status' in body) {
      triageUpdate(id, body.triage_status);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/xfeed/[id] error');
    return NextResponse.json({ error: 'Failed to update tweet' }, { status: 500 });
  }
}
