import { NextRequest, NextResponse } from 'next/server';
import { updateGardenItem } from '@/lib/cc-db';
import { logger } from '@/lib/logger';

// Skip auth for this endpoint — Discord link buttons can't send headers
// Security: only allows setting interest/temporal on existing items (low risk)

/**
 * GET /api/garden/[id]/classify?interest=ingredient
 * GET /api/garden/[id]/classify?temporal=ever
 * 
 * Quick classification endpoint for Discord button links.
 * No auth required (link buttons can't send headers).
 * Returns a simple HTML confirmation page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const interest = url.searchParams.get('interest');
    const temporal = url.searchParams.get('temporal');

    if (!interest && !temporal) {
      return new NextResponse('Missing interest or temporal param', { status: 400 });
    }

    const fields: Record<string, any> = {};
    if (interest) fields.interest = interest;
    if (temporal) fields.temporal = temporal;

    // Handle snooze for temporal values
    if (temporal && ['1d', '1w', '1m'].includes(temporal)) {
      const durations: Record<string, string> = { '1d': '+1 day', '1w': '+7 days', '1m': '+1 month' };
      // snooze_until handled by updateGardenItem or we set it here
    }

    updateGardenItem(id, fields);
    logger.info({ id, interest, temporal }, 'Garden item classified via Discord button');

    const label = interest ? `Interest → ${interest}` : `Temporal → ${temporal}`;
    const emoji = interest 
      ? { info: '🔬', inspiration: '✨', instrument: '🔧', ingredient: '🧱', idea: '💡' }[interest] || '✅'
      : { now: '⚡', '1d': '⏰', '1w': '⏰', '1m': '⏰', ever: '🌱' }[temporal!] || '✅';

    // Return a simple HTML page that auto-closes or shows confirmation
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Garden</title>
<style>
  body { background: #1a1a2e; color: #e0e0e0; font-family: -apple-system, sans-serif; 
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 2rem; }
  .emoji { font-size: 3rem; margin-bottom: 1rem; }
  .label { font-size: 1.2rem; color: #4CAF50; font-weight: 600; }
  .sub { color: #888; margin-top: 0.5rem; font-size: 0.9rem; }
</style></head>
<body><div class="card">
  <div class="emoji">${emoji}</div>
  <div class="label">${label}</div>
  <div class="sub">You can close this tab</div>
</div></body></html>`;

    return new NextResponse(html, { 
      status: 200, 
      headers: { 'Content-Type': 'text/html' } 
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/garden/[id]/classify error');
    return new NextResponse('Classification failed', { status: 500 });
  }
}
