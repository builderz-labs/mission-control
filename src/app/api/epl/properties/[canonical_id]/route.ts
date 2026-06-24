/**
 * GET /api/epl/properties/[canonical_id]
 *
 * Per-flat detail drawer. Aggregator skeleton that pulls from every
 * canonical source — BOOM (property metadata) + PriceLabs (occupancy +
 * recommendation) + James (P&L) + Iris (guest score + complaints) +
 * Hugo (maintenance) + Larry (landlord) + Marcus (compliance).
 *
 * Currently mock; each section flagged with `source` so the Emergent
 * drawer UI can show "(mock)" badges and Jose can replace one source
 * at a time without breaking the contract.
 *
 * Cross-nav: drawer "open in Maintenance" → /maintenance?filter=<id>
 *            drawer "open in Decisions"   → /decisions?canonical_id=<id>
 *            drawer "open in James P&L"   → /james-pl?canonical_id=<id> (future)
 */

import { NextRequest, NextResponse } from 'next/server'
import { tryFetchAgentStats } from '../../agents/_helpers'

const HUGO_STATS_URL = process.env.HUGO_STATS_URL || 'http://localhost:8000/api/stats'

// Mock per-flat snapshots keyed by canonical_id. In production these come
// from the canonical aggregators; this file is the drawer's data shape.
const SNAPSHOT: Record<string, any> = {
  VAUXHALL_1: {
    canonical_id: 'VAUXHALL_1',
    display_name: '1 Stoddart House',
    brand: 'EPL',
    address: 'Stoddart House, Vauxhall Walk, London SE11',
    beds: 2, baths: 2,
    landlord: 'Pacific Estates (Islam Hossain)',
    contract: { type: 'EPL leasehold', start: '2024-03-01', term_years: 5, break: 'mutual 24m' },
    occupancy: { source: 'PriceLabs', last_30d: 92, forward_30d: 88, pricelabs_rec: 174.55, actual_adr_30d: 178.26 },
    pl: { source: 'James', month: '2026-05', revenue: 5340, opex: 3540, net: 1800 },
    guest: { source: 'Iris', score_30d: 4.6, complaints_30d: 2, last_review: '2026-05-22' },
    compliance: { source: 'Marcus', gas: 'in date', electrical: 'in date', tba_agreement: '13 May TBD still in force' },
    open_decisions: [{ id: 'R1', title: 'Pacific Estates VAUXHALL — approve draft', age_days: 4 }],
  },
  MAYFAIR_1: {
    canonical_id: 'MAYFAIR_1',
    display_name: 'Mayfair Mansion',
    brand: 'EPL',
    address: 'Mount Street, London W1K',
    beds: 2, baths: 2,
    landlord: 'Mayfair Holdings',
    contract: { type: 'EPL leasehold', start: '2023-09-15', term_years: 5, break: 'mutual 36m' },
    occupancy: { source: 'PriceLabs', last_30d: 95, forward_30d: 91, pricelabs_rec: 410, actual_adr_30d: 420 },
    pl: { source: 'James', month: '2026-05', revenue: 11900, opex: 9500, net: 2400 },
    guest: { source: 'Iris', score_30d: 4.9, complaints_30d: 0, last_review: '2026-05-24' },
    compliance: { source: 'Marcus', gas: 'in date', electrical: 'in date' },
    open_decisions: [],
  },
  SHOREDITCH_3: {
    canonical_id: 'SHOREDITCH_3',
    display_name: 'Flat 5, 223 Shoreditch High Street',
    brand: 'NourNest',
    address: 'Flat 5, 223 Shoreditch High Street, London E1 6PJ',
    beds: 3, baths: 2,
    landlord: 'Ronan & Paul',
    contract: { type: 'NourNest management', start: '2026-05-27', term_years: 4, break: 'mutual 24m' },
    occupancy: { source: 'PriceLabs', last_30d: 0, forward_30d: 0, note: 'onboarding — commences 27 May' },
    pl: { source: 'James', month: '2026-05', revenue: 0, opex: 0, net: 0 },
    guest: { source: 'Iris', score_30d: 0, complaints_30d: 0 },
    compliance: { source: 'Marcus', status: 'pending — Nina onboarding playbook' },
    open_decisions: [],
  },
}

async function maintenanceFor(canonical_id: string): Promise<any> {
  // Try Hugo first; fall back to a small mock count.
  const live = await tryFetchAgentStats(HUGO_STATS_URL)
  if (live) {
    return { source: 'Hugo (live)', open: 0, p0: 0, note: 'real per-property count requires Hugo extension' }
  }
  // Mock from /api/epl/maintenance shape — count tickets for this property.
  const mockCounts: Record<string, { open: number; p0: number; awaiting_parts: number }> = {
    VAUXHALL_1:   { open: 3, p0: 0, awaiting_parts: 1 },
    MAYFAIR_1:    { open: 0, p0: 0, awaiting_parts: 0 },
    SHOREDITCH_3: { open: 0, p0: 0, awaiting_parts: 0 },
  }
  return { source: 'Hugo (offline — mock)', ...(mockCounts[canonical_id] ?? { open: 0, p0: 0, awaiting_parts: 0 }) }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ canonical_id: string }> }) {
  const { canonical_id } = await ctx.params
  const snap = SNAPSHOT[canonical_id]
  if (!snap) {
    return NextResponse.json(
      { error: 'unknown canonical_id', canonical_id, available: Object.keys(SNAPSHOT) },
      { status: 404 },
    )
  }
  const maintenance = await maintenanceFor(canonical_id)
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    ...snap,
    maintenance,
    aggregator_note: 'Single source per field — flagged in each section.',
  })
}
