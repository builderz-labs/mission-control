/**
 * GET /api/epl/maintenance/[ticket_id]
 *
 * Full ticket detail for the Maintenance drawer Emergent will build.
 * Returns: ticket + photo URLs + parser source message + status timeline +
 * assignee Slack profile + property cross-link.
 *
 * Source: Hugo's supabase `maintenance_tickets` table once VPS-deployed.
 * Until then: small mock matching the 13-ticket fleet in /api/epl/maintenance.
 *
 * Assignee allowlist enforced — strips Hanna U07FQ300EVB + Abuzar dup U09MSN2EFK6.
 */

import { NextRequest, NextResponse } from 'next/server'

const FORBIDDEN_SLACK_IDS = new Set(['U07FQ300EVB', 'U09MSN2EFK6'])

const TICKET_DETAIL: Record<string, any> = {
  'T-001': {
    id: 'T-001',
    property: { canonical_id: 'VAUXHALL_1', display_name: '1 Stoddart House' },
    severity: 'P1',
    status: 'in_progress',
    summary: 'Boiler error E04 — no hot water',
    description: 'Tenant reports E04 on the Worcester boiler since ~05:30. No hot water in shower or kitchen. Pressure gauge reads 1.2 bar (within range).',
    assignee: { name: 'Zain', slack_id: 'U0AR9HTB4F4' },
    photos: [],
    parser: {
      source: 'whatsapp',
      group: 'EPL Maintenance',
      sender_phone: '+44 7700 900111',
      raw_text: 'Hi team, no hot water flat 1 stoddart house. Boiler shows E04 since this morning. Tenant in shower now.',
      parsed_by: 'Claude Sonnet 4.5',
      parsed_at: '2026-05-26T07:12:00Z',
      confidence: 0.94,
    },
    timeline: [
      { ts: '2026-05-26T07:12:00Z', actor: 'hugo', event: 'created', detail: 'P1 — boiler error' },
      { ts: '2026-05-26T07:30:00Z', actor: 'hugo', event: 'assigned', detail: 'Routed to Zain (P0/P1 desk)' },
      { ts: '2026-05-26T08:15:00Z', actor: 'U0AR9HTB4F4', event: 'in_progress', detail: 'Zain on site within 1h' },
    ],
    age_hours: 18,
  },
  'T-010': {
    id: 'T-010',
    property: { canonical_id: 'EUSTON_1', display_name: 'Euston Flat 1' },
    severity: 'P0',
    status: 'in_progress',
    summary: 'Keybox jammed — guest cannot collect key',
    description: 'Guest arrived 15:30, keybox dial jammed at digit 3. Guest waiting in lobby. Property check-in scheduled 16:00.',
    assignee: { name: 'Zain', slack_id: 'U0AR9HTB4F4' },
    photos: ['https://example.com/photo-keybox-jam-001.jpg'],
    parser: {
      source: 'whatsapp',
      group: 'EPL Maintenance',
      sender_phone: '+44 7700 900200',
      raw_text: 'URGENT keybox stuck guest waiting outside Euston 1 cannot get in',
      parsed_by: 'Claude Sonnet 4.5',
      parsed_at: '2026-05-26T15:32:00Z',
      confidence: 0.98,
    },
    timeline: [
      { ts: '2026-05-26T15:32:00Z', actor: 'hugo', event: 'created', detail: 'P0 — guest blocked' },
      { ts: '2026-05-26T15:32:30Z', actor: 'hugo', event: 'escalated', detail: 'P0 SLA: 30m — Zain DM + #maintenance ping' },
      { ts: '2026-05-26T15:50:00Z', actor: 'U0AR9HTB4F4', event: 'in_progress', detail: 'Zain en route' },
    ],
    age_hours: 1,
  },
}

function sanitiseAssignee(detail: any) {
  if (detail?.assignee?.slack_id && FORBIDDEN_SLACK_IDS.has(detail.assignee.slack_id)) {
    return { ...detail, assignee: { name: 'unassigned', slack_id: null, note: 'forbidden slack_id stripped' } }
  }
  return detail
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ ticket_id: string }> }) {
  const { ticket_id } = await ctx.params
  const detail = TICKET_DETAIL[ticket_id]
  if (!detail) {
    return NextResponse.json(
      { error: 'unknown ticket_id', ticket_id, hint: 'Hugo /api/tickets/[id] not wired yet; mock available for T-001, T-010.' },
      { status: 404 },
    )
  }
  return NextResponse.json({ generatedAt: new Date().toISOString(), source: 'mock', ...sanitiseAssignee(detail) })
}
