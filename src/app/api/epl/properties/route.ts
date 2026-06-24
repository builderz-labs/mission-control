/**
 * GET /api/epl/properties
 *
 * 16-tile heat map + Hot/Star callouts + portfolio KPIs.
 *
 * REAL DATA: reads /atlas-data/mc_properties.json (written hourly by Atlas's
 * exporter atlas/scripts/mc_properties_export.py from James's workbook +
 * the canonical Property Aliases registry). Falls back to the mock tiles
 * below only if that file is absent/unreadable.
 *
 * Aggregator principle (canonical-only):
 *   - flat list      → Property Aliases tab (sheet 1cknTr9J6BSkqpHIebo17oNQZJsp4v9CLmGZc-iL6SZA)
 *   - revenue        → James monthly P&L (net margin, latest populated month)
 *   - occupancy      → James workbook performance sheet (latest populated month)
 *   - guest score    → James workbook Avg Score (Iris not yet wired)
 *   - maintenance    → Hugo (not deployed) → null → shown as "—"
 *   - status         → derived (data-bearing flats = live)
 *
 * Honesty: metrics with no real value are null and render as "—", never
 * fabricated. Each metric's period is in `as_of`. No new local property dicts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'

type HeatState = 'hot' | 'warm' | 'neutral' | 'cool' | 'cold'

interface Tile {
  canonical_id: string
  display_name: string
  beds: number | null
  brand: 'EPL' | 'Staylio' | 'NourNest' | 'UrbanReady'
  heat: HeatState
  occupancy_30d: number | null  // 0-100
  net_margin_30d: number | null // £ this month
  guest_score: number | null    // 0-5
  open_tickets: number | null
  status: 'live' | 'onboarding' | 'archived'
}

// ── Mock fallback (only served if the real export is missing) ─────────────
const MOCK_TILES: Tile[] = [
  { canonical_id: 'VAUXHALL_1', display_name: '1 Stoddart House',  beds: 2, brand: 'EPL',       heat: 'hot',     occupancy_30d: 92, net_margin_30d: 1800, guest_score: 4.6, open_tickets: 3, status: 'live' },
  { canonical_id: 'MAYFAIR_1',  display_name: 'Mayfair Mansion',   beds: 2, brand: 'EPL',       heat: 'hot',     occupancy_30d: 95, net_margin_30d: 2400, guest_score: 4.9, open_tickets: 0, status: 'live' },
  { canonical_id: 'KINGS_X_63', display_name: '63 Kings Cross',    beds: 1, brand: 'Staylio',   heat: 'warm',    occupancy_30d: 81, net_margin_30d: 1200, guest_score: 4.7, open_tickets: 1, status: 'live' },
  { canonical_id: 'REGENTS_M',  display_name: 'Regents M',         beds: 1, brand: 'Staylio',   heat: 'warm',    occupancy_30d: 78, net_margin_30d: 1100, guest_score: 4.5, open_tickets: 1, status: 'live' },
  { canonical_id: 'PIMLICO_1',  display_name: 'Pimlico Flat',      beds: 1, brand: 'EPL',       heat: 'neutral', occupancy_30d: 71, net_margin_30d:  900, guest_score: 4.4, open_tickets: 0, status: 'live' },
  { canonical_id: 'EUSTON_1',   display_name: 'Euston Flat 1',     beds: 1, brand: 'Staylio',   heat: 'neutral', occupancy_30d: 68, net_margin_30d:  850, guest_score: 4.3, open_tickets: 2, status: 'live' },
  { canonical_id: 'BAKER_2',    display_name: 'Baker St Flat 2',   beds: 3, brand: 'EPL',       heat: 'warm',    occupancy_30d: 83, net_margin_30d: 1700, guest_score: 4.8, open_tickets: 0, status: 'live' },
  { canonical_id: 'RUSSELL_SQ', display_name: 'Russell Square',    beds: 2, brand: 'EPL',       heat: 'cool',    occupancy_30d: 55, net_margin_30d:  650, guest_score: 4.0, open_tickets: 4, status: 'live' },
]

const REAL_PATH = process.env.MC_PROPERTIES_JSON || '/atlas-data/mc_properties.json'

interface LoadResult {
  tiles: Tile[]
  as_of?: Record<string, string>
  sources?: Record<string, unknown>
  counts?: Record<string, unknown>
  generatedAt?: string
  real: boolean
}

function loadData(): LoadResult {
  try {
    const raw = JSON.parse(readFileSync(REAL_PATH, 'utf8'))
    if (Array.isArray(raw.tiles) && raw.tiles.length > 0) {
      return {
        tiles: raw.tiles as Tile[],
        as_of: raw.as_of,
        sources: raw.sources,
        counts: raw.counts,
        generatedAt: raw.generatedAt,
        real: true,
      }
    }
  } catch {
    // fall through to mock
  }
  return { tiles: MOCK_TILES, real: false }
}

const REAL_SOURCES = {
  registry: 'Property Aliases tab (sheet 1cknTr9J6BSkqpHIebo17oNQZJsp4v9CLmGZc-iL6SZA)',
  revenue: 'James monthly P&L',
  occupancy: 'James performance sheet',
  guest_score: 'James Avg Score (Iris not yet wired)',
  open_tickets: 'pending — Hugo not deployed',
  status: 'derived (data-bearing = live)',
}

function callouts(tiles: Tile[]) {
  const hot = tiles.filter(t => t.heat === 'hot').slice(0, 3)
  const star = tiles
    .filter(t => t.status === 'live' && (t.guest_score ?? 0) >= 4.7)
    .sort((a, b) => (b.guest_score ?? 0) - (a.guest_score ?? 0))
    .slice(0, 3)
  const cold = tiles.filter(t => t.heat === 'cold' || t.heat === 'cool').slice(0, 3)
  return { hot, star, cold }
}

export async function GET(req: NextRequest) {
  const { tiles, as_of, sources, counts, generatedAt, real } = loadData()
  const url = new URL(req.url)
  const part = url.searchParams.get('part')

  if (part === 'kpis') {
    const live = tiles.filter(t => t.status === 'live')
    const occVals = live.map(t => t.occupancy_30d).filter((v): v is number => v != null)
    const scoreVals = live.map(t => t.guest_score).filter((v): v is number => v != null)
    const totalNet = live.reduce((s, t) => s + (t.net_margin_30d ?? 0), 0)
    const ticketsKnown = tiles.map(t => t.open_tickets).filter((v): v is number => v != null)
    return NextResponse.json({
      total: tiles.length,
      live: live.length,
      onboarding: tiles.filter(t => t.status === 'onboarding').length,
      avg_occupancy_30d: occVals.length ? Math.round(occVals.reduce((s, v) => s + v, 0) / occVals.length) : null,
      total_net_margin_30d: totalNet,
      avg_guest_score: scoreVals.length ? Math.round((scoreVals.reduce((s, v) => s + v, 0) / scoreVals.length) * 100) / 100 : null,
      open_tickets: ticketsKnown.length ? ticketsKnown.reduce((s, v) => s + v, 0) : null,
    })
  }

  if (part === 'tiles') {
    return NextResponse.json({ tiles })
  }

  if (part === 'callouts') {
    return NextResponse.json(callouts(tiles))
  }

  if (part === 'summary') {
    return NextResponse.json({ ok: true, tile_count: tiles.length, real })
  }

  return NextResponse.json({
    generatedAt: generatedAt || new Date().toISOString(),
    real,
    as_of,
    tiles,
    callouts: callouts(tiles),
    counts,
    sources: real ? sources : { ...REAL_SOURCES, note: 'MOCK fallback — real export /atlas-data/mc_properties.json not found' },
  })
}
