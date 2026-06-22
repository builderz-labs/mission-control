/**
 * GET /api/epl/access-map
 *
 * The Team Access Map — the canonical "setups" list (24 tools), the role
 * onboarding bundles, and the 1Password vault plan. Reads the Atlas-owned CSVs
 * mounted at /atlas-data/access_map_csv (local dev: ~/atlas/data/access_map_csv)
 * via src/lib/access-map.ts. No hardcoded copy — updates whenever Atlas
 * regenerates the map from access_map.yaml.
 *
 * Returns { source, dir, updatedAt, counts, tools, roles, vaults }. When the
 * CSV is missing, source='unavailable' so the panel renders an honest state.
 */

import { NextResponse } from 'next/server'
import { readAccessMap } from '@/lib/access-map'

export async function GET() {
  const m = readAccessMap()
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    source: m.source,
    dir: m.dir,
    updatedAt: m.updatedAt,
    counts: { tools: m.tools.length, roles: m.roles.length, vaults: m.vaults.length },
    tools: m.tools,
    roles: m.roles,
    vaults: m.vaults,
    error: m.error,
  })
}
