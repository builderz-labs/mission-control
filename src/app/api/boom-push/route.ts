import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

/**
 * Mission Control → BOOM publish.
 *
 * POST /api/boom-push — operator publishes a guest-portal INFO TOPIC to a BOOM
 *   listing. MC forwards a contract-shaped PushItem to Atlas's boom-push intake
 *   (config.atlas.boomPushUrl), which writes it via the browser-free
 *   InternalApiPaster — no Chrome, immune to UI drift. Atlas validates, dedups,
 *   verifies and answers honestly ({ok, posted, verified, skipped}); it returns
 *   ok:false ("not armed") until ATLAS_BOOM_PUSH_LIVE=1, so MC never claims a
 *   write that did not happen.
 *
 * FAQs are intentionally NOT offered here (the API path is topics-only; FAQ
 * writes replace the whole array).
 */

export interface BoomPublishInput {
  listingId: number;
  topic?: string;
  title: string;
  body: string;
  audience?: { guests?: boolean; ai?: boolean; owners?: boolean };
}

const ACTION = 'upsert_topic';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

/** Build the exact PushItem Atlas's contract expects. Pure → unit-tested. */
export function buildPushItem(input: BoomPublishInput, requestedBy: string) {
  const listingId = input.listingId;
  const topic = (input.topic || '').trim();
  const title = input.title.trim();
  const body = input.body.trim();
  const audience = {
    guests: input.audience?.guests ?? true,
    ai: input.audience?.ai ?? true,
    owners: input.audience?.owners ?? false,
  };
  // content_hash mirrors Iris/Atlas: sha1(property_id|action|title|body).
  const content_hash = createHash('sha1')
    .update(`${listingId}|${ACTION}|${title}|${body}`)
    .digest('hex');
  return {
    agent: 'mission-control',
    source: 'mc_manual',
    idempotency_key: `mc|${listingId}|${slug(title)}`,
    content_hash,
    property_id: listingId,
    canonical_id: '',
    flat: '',
    target_url: `https://app.boomnow.com/dashboard/edit/${listingId}/services`,
    action: ACTION,
    topic,
    title,
    body,
    dedup: { search_text: title },
    audience,
    requested_by: requestedBy,
  };
}

function validate(input: any): { error: string } | { ok: BoomPublishInput } {
  const listingId = Number(input?.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) return { error: 'listingId must be a positive integer' };
  if (typeof input?.title !== 'string' || !input.title.trim()) return { error: 'title is required' };
  if (typeof input?.body !== 'string' || !input.body.trim()) return { error: 'body is required' };
  if (input.body.trim().length > 4000) return { error: 'body too long (max 4000 chars)' };
  if (input.topic != null && typeof input.topic !== 'string') return { error: 'topic must be a string' };
  return { ok: { listingId, topic: input.topic, title: input.title, body: input.body, audience: input.audience } };
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = mutationLimiter(request);
  if (limited) return limited;

  if (!config.atlas.boomPushUrl) {
    return NextResponse.json(
      { error: 'BOOM publish not configured — set ATLAS_BOOM_PUSH_URL' },
      { status: 503 }
    );
  }

  const parsed = validate(await request.json().catch(() => ({})));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const requestedBy = auth.user.username || auth.user.email || 'mc';
  const item = buildPushItem(parsed.ok, requestedBy);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.atlas.boomPushKey) headers['X-Boom-Push-Key'] = config.atlas.boomPushKey;

  let res: Response;
  try {
    res = await fetch(`${config.atlas.boomPushUrl.replace(/\/$/, '')}/boom-push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    logger.error({ listingId: item.property_id, err: String(err) }, 'boom-push: Atlas intake unreachable');
    return NextResponse.json({ error: 'Atlas boom-push service unreachable', detail: String(err) }, { status: 502 });
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Atlas returns ok:false / non-2xx when not armed or on refusal — surface it.
    logger.warn({ listingId: item.property_id, status: res.status, body }, 'boom-push: Atlas declined');
    return NextResponse.json(
      { ok: false, error: body.error || body.note || 'Atlas declined the publish', atlasStatus: res.status, ...body },
      { status: res.status }
    );
  }

  logger.info({ listingId: item.property_id, posted: body.posted, verified: body.verified }, 'boom-push: forwarded');
  return NextResponse.json({ ok: true, ...body });
}
