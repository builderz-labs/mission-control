import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

/**
 * GET /api/boom-listing-topics?listingId=NNN — proxy a single listing's CURRENT
 * guidebook items through Atlas, so the Publish-to-BOOM UI can show what already
 * exists before the operator adds or edits a topic (no blind writes). Read-only.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!config.atlas.boomPushUrl) {
    return NextResponse.json({ error: 'BOOM not configured — set ATLAS_BOOM_PUSH_URL' }, { status: 503 });
  }

  const listingId = Number(request.nextUrl.searchParams.get('listingId'));
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return NextResponse.json({ error: 'listingId (positive integer) required' }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  if (config.atlas.boomPushKey) headers['X-Boom-Push-Key'] = config.atlas.boomPushKey;

  try {
    const res = await fetch(
      `${config.atlas.boomPushUrl.replace(/\/$/, '')}/boom-listing-topics?listingId=${listingId}`,
      { method: 'GET', headers, signal: AbortSignal.timeout(30_000) }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: body.error || 'Atlas read failed', ...body }, { status: res.status });
    }
    return NextResponse.json({ ok: true, items: body.items ?? [] });
  } catch (err) {
    logger.error({ listingId, err: String(err) }, 'boom-listing-topics: Atlas unreachable');
    return NextResponse.json({ error: 'Atlas BOOM read service unreachable', detail: String(err) }, { status: 502 });
  }
}
