/**
 * /api/epl/decisions
 *
 * GET  — decisions by category + age-risk callout + Atlas recommendations.
 *        Now backed by the epl_decisions SQLite table (migration 051), seeded
 *        with the original 32 mock rows so the panel never regresses.
 *
 *        ?part=summary      → counts { total, open, decided, blocked }
 *        ?part=age-risk     → open items with age_days > 10
 *        ?part=by-category  → grouped by category
 *        ?part=routable     → approved items awaiting Atlas routing
 *        (default)          → { generatedAt, decisions }
 *
 * POST — intake. Idempotent create of a candidate decision/backlog item from an
 *        upstream source (Edward's Zoom scan, an email forward, manual). Gated
 *        by the MC API key. Body: CreateDecisionInput. Re-posting the same item
 *        collapses onto the existing row (inserted:false).
 *
 * Categories: Hugo · Rapid · Architecture · AI Policies · MC build · Maintenance.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  listDecisions,
  listRoutable,
  createDecision,
  checkApiKey,
  type EplDecision,
  type CreateDecisionInput,
} from '@/lib/epl-decisions'

export async function GET(req: NextRequest) {
  const part = new URL(req.url).searchParams.get('part')
  const decisions = listDecisions()

  if (part === 'summary') {
    return NextResponse.json({
      ok: true,
      total: decisions.length,
      open: decisions.filter(d => d.status === 'open').length,
      decided: decisions.filter(d => d.status === 'decided').length,
      blocked: decisions.filter(d => d.status === 'blocked').length,
    })
  }

  if (part === 'age-risk') {
    const aged = decisions.filter(d => d.status === 'open' && d.age_days > 10)
    return NextResponse.json({ aged_count: aged.length, items: aged })
  }

  if (part === 'by-category') {
    const groups: Record<string, EplDecision[]> = {}
    decisions.forEach(d => {
      if (!groups[d.category]) groups[d.category] = []
      groups[d.category].push(d)
    })
    return NextResponse.json({ groups })
  }

  if (part === 'routable') {
    const items = listRoutable()
    return NextResponse.json({ count: items.length, items })
  }

  return NextResponse.json({ generatedAt: new Date().toISOString(), decisions })
}

export async function POST(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const input = body as Partial<CreateDecisionInput>
  if (!input || typeof input.title !== 'string' || input.title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (typeof input.source !== 'string' || input.source.trim().length === 0) {
    return NextResponse.json({ error: 'source is required' }, { status: 400 })
  }

  const { decision, inserted } = createDecision({
    title: input.title.trim().slice(0, 500),
    source: input.source.trim(),
    category: input.category,
    owner: input.owner,
    recommendation: input.recommendation,
    default_applied: input.default_applied,
    proposed_payload: input.proposed_payload,
    id: input.id,
    dedupe_key: input.dedupe_key,
  })

  return NextResponse.json({ ok: true, inserted, decision }, { status: inserted ? 201 : 200 })
}
