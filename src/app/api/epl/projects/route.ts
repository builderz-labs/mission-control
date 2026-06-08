/**
 * GET /api/epl/projects
 *
 * 6-column Kanban data: Inbox · Up next · In progress · Waiting · Review · Done (this wk).
 * Mock matches /mockup/projects-panel-preview.html.
 *
 * ⚠️ ARCHITECTURE DECISION 28 May 2026:
 *   Asana is ARCHIVE-ONLY. This panel reads ACTIVE work from BOOM Boards + MC own
 *   tables. Asana is a read-only secondary source for historical lookup only.
 *   See memory/decision_asana_archive_only_28may.md.
 *
 * Wire sources (TODO):
 *   - BOOM Boards (/app/taskim/*) — PRIMARY for active project cards (when BOOM API/scraper ready)
 *   - decisions.yaml (R1-R32) for "Waiting" + "Review"
 *   - atlas.db.tasks for "In progress" + "Up next"
 *   - mc-cli `tasks queue --json` for "Inbox"
 *   - Asana (READ-ONLY): historical reference only — not for active project columns
 */

import { NextRequest, NextResponse } from 'next/server'

const COLUMNS = [
  {
    id: 'inbox',
    label: 'Inbox',
    cards: [
      { id: 'P-101', title: 'New Shoreditch building — 2 flats (Ronan+Paul)', owner: 'Nina', tags: ['onboarding'], age: '0d' },
      { id: 'P-102', title: 'Montrose Court Princes Gate — direct landlord', owner: 'Larry', tags: ['acquisition', 'EPL'], age: '0d' },
    ],
  },
  {
    id: 'up_next',
    label: 'Up next',
    cards: [
      { id: 'P-201', title: 'Hugo VPS deploy + Supabase migration', owner: 'Hugo', tags: ['agent-build'], age: '1d' },
      { id: 'P-202', title: 'Backfill 12,880-line WhatsApp corpus', owner: 'Hugo', tags: ['data'], age: '1d' },
      { id: 'P-203', title: 'Hanna replacement JD — Sales Lead', owner: 'Gerda', tags: ['hiring'], age: '0d' },
    ],
  },
  {
    id: 'in_progress',
    label: 'In progress',
    cards: [
      { id: 'P-301', title: 'MC custom panels — Jose builds React from mockups', owner: 'Jose', tags: ['MC', 'visual'], age: '0d' },
      { id: 'P-302', title: 'Larry Phase 2c — Atlas Slack relay wiring', owner: 'Atlas', tags: ['agent'], age: '1d' },
      { id: 'P-303', title: 'Owen Phase 2b — recipes + venv pip install', owner: 'Owen', tags: ['agent'], age: '0d' },
    ],
  },
  {
    id: 'waiting',
    label: 'Waiting',
    cards: [
      { id: 'P-401', title: 'Pacific Estates VAUXHALL — landlord email response', owner: 'Larry', tags: ['landlord'], age: '4d' },
      { id: 'P-402', title: 'Per-Flat Enrichment Queue v2 — share sheet with SA', owner: 'Owen', tags: ['data'], age: '0d' },
      { id: 'P-403', title: 'Marcus 13 May TBD compensation — landlord countersign', owner: 'Marcus', tags: ['compliance'], age: '13d' },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    cards: [
      { id: 'P-501', title: 'Guest Experience Loop v2 — Zain Euston 1 sample', owner: 'Iris',  tags: ['QA'], age: '2d' },
      { id: 'P-502', title: 'AI Policies v1 — P01/P07/P12 LIVE this week',     owner: 'Gerda', tags: ['governance'], age: '0d' },
    ],
  },
  {
    id: 'done_this_week',
    label: 'Done (this week)',
    cards: [
      { id: 'P-601', title: 'Hugo Phase 1 code — 2,227 lines · 22/22 tests', owner: 'Hugo',  tags: ['agent-build'], age: '0d' },
      { id: 'P-602', title: 'Atlas Larry Slack relay shipped',               owner: 'Atlas', tags: ['agent'], age: '1d' },
      { id: 'P-603', title: 'Owen Phase 0+1+2a shipped — 67 tests',          owner: 'Owen',  tags: ['agent-build'], age: '0d' },
      { id: 'P-604', title: 'MC 5 custom panels — all signed off',           owner: 'Gerda', tags: ['MC', 'visual'], age: '0d' },
      { id: 'P-605', title: 'Property Aliases — SHOREDITCH_3 + BALFOUR + STUDIO', owner: 'Registry', tags: ['data'], age: '0d' },
    ],
  },
]

export async function GET(req: NextRequest) {
  const part = new URL(req.url).searchParams.get('part')
  if (part === 'summary') {
    return NextResponse.json({
      ok: true,
      counts: Object.fromEntries(COLUMNS.map(c => [c.id, c.cards.length])),
      total: COLUMNS.reduce((s, c) => s + c.cards.length, 0),
    })
  }
  return NextResponse.json({ generatedAt: new Date().toISOString(), columns: COLUMNS })
}
