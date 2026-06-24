import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

/**
 * GET /api/boom-topics — proxy BOOM's tenant-wide topic taxonomy (105 parent
 * topics / 600+ leaves) through Atlas's read endpoint, so the Publish-to-BOOM
 * UI can offer a real topic dropdown instead of a blind free-text field.
 * Read-only; never writes.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!config.atlas.boomPushUrl) {
    return NextResponse.json({ error: 'BOOM not configured — set ATLAS_BOOM_PUSH_URL' }, { status: 503 });
  }

  const headers: Record<string, string> = {};
  if (config.atlas.boomPushKey) headers['X-Boom-Push-Key'] = config.atlas.boomPushKey;

  try {
    const res = await fetch(`${config.atlas.boomPushUrl.replace(/\/$/, '')}/boom-topics`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: body.error || 'Atlas read failed', ...body }, { status: res.status });
    }
    return NextResponse.json({ ok: true, defs: body.defs ?? [] });
  } catch (err) {
    logger.error({ err: String(err) }, 'boom-topics: Atlas unreachable');
    return NextResponse.json({ error: 'Atlas BOOM read service unreachable', detail: String(err) }, { status: 502 });
  }
}
