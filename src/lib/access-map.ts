/**
 * Team Access Map reader — the canonical "setups" list.
 *
 * Source of truth is Atlas-owned: `~/atlas/config/access_map.yaml` regenerated
 * into CSVs under `~/atlas/data/access_map_csv/` (3 tabs: Access Map ·
 * Onboarding Checklist · 1Password Plan). That data dir is mounted read-only
 * into the MC container at `/atlas-data` (see docker-compose.yml), so the CSVs
 * are reachable in prod at `/atlas-data/access_map_csv/`.
 *
 * Surfacing the map in MC was on Atlas's roadmap (reference_team_access_map.md)
 * but unbuilt — this reads the live CSV instead of hardcoding a stale copy.
 * Never throws — returns an `unavailable` marker so the panel can render an
 * honest "source offline" state.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function accessMapDir(): string {
  const env = process.env.ACCESS_MAP_CSV_DIR
  if (env) return env
  const candidates = [
    '/atlas-data/access_map_csv',
    path.join(os.homedir(), 'atlas', 'data', 'access_map_csv'),
    '/opt/atlas/data/access_map_csv',
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface AccessTool {
  tool: string
  category: string
  entity: string
  owner: string
  multiUser: string
  whereLoginLives: string
  vaultTarget: string
  roles: string[]
  confirm: boolean
  notes: string
}

export interface AccessRoleBundle {
  role: string
  vaults: string[]
  seats: string[]
}

export interface AccessVault {
  vault: string
  status: string
  holds: string[]
  grantTo: string[]
  note: string
}

export interface AccessMapResult {
  source: 'atlas-csv' | 'unavailable'
  dir: string
  updatedAt: string | null
  tools: AccessTool[]
  roles: AccessRoleBundle[]
  vaults: AccessVault[]
  error?: string
}

function splitList(s: string | undefined): string[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function read(file: string): { rows: string[][]; mtime: number } | null {
  if (!existsSync(file)) return null
  try {
    return { rows: parseCsv(readFileSync(file, 'utf-8')), mtime: statSync(file).mtimeMs }
  } catch {
    return null
  }
}

export function readAccessMap(): AccessMapResult {
  const dir = accessMapDir()
  const mapFile = path.join(dir, '1_access_map.csv')
  const checklistFile = path.join(dir, '2_onboarding_checklist.csv')
  const vaultFile = path.join(dir, '3_onepassword_plan.csv')

  const map = read(mapFile)
  if (!map) {
    return { source: 'unavailable', dir, updatedAt: null, tools: [], roles: [], vaults: [], error: 'access-map-csv-missing' }
  }

  let latestMtime = map.mtime

  // ── Tools (1_access_map.csv): header row is the one starting with "Tool". ──
  const tools: AccessTool[] = []
  const headerIdx = map.rows.findIndex((r) => (r[0] || '').trim() === 'Tool')
  if (headerIdx >= 0) {
    for (const r of map.rows.slice(headerIdx + 1)) {
      const tool = (r[0] || '').trim()
      if (!tool) continue
      tools.push({
        tool,
        category: (r[1] || '').trim(),
        entity: (r[2] || '').trim(),
        owner: (r[3] || '').trim(),
        multiUser: (r[4] || '').trim(),
        whereLoginLives: (r[5] || '').trim(),
        vaultTarget: (r[6] || '').trim(),
        roles: splitList(r[7]),
        confirm: (r[8] || '').includes('🟡') || (r[8] || '').toLowerCase().includes('confirm'),
        notes: (r[9] || '').trim(),
      })
    }
  }

  // ── Role bundles (2_onboarding_checklist.csv): QUICK START section. ──
  const roles: AccessRoleBundle[] = []
  const cl = read(checklistFile)
  if (cl) {
    latestMtime = Math.max(latestMtime, cl.mtime)
    const roleHdr = cl.rows.findIndex((r) => (r[0] || '').trim() === 'Role' && (r[1] || '').toLowerCase().includes('1password'))
    if (roleHdr >= 0) {
      for (const r of cl.rows.slice(roleHdr + 1)) {
        const role = (r[0] || '').trim()
        if (!role || role.startsWith('FULL MATRIX')) break
        roles.push({ role, vaults: splitList(r[1]), seats: splitList(r[2]) })
      }
    }
  }

  // ── 1Password vault plan (3_onepassword_plan.csv). ──
  const vaults: AccessVault[] = []
  const vp = read(vaultFile)
  if (vp) {
    latestMtime = Math.max(latestMtime, vp.mtime)
    const vHdr = vp.rows.findIndex((r) => (r[0] || '').trim() === 'Vault')
    if (vHdr >= 0) {
      for (const r of vp.rows.slice(vHdr + 1)) {
        const vault = (r[0] || '').trim()
        if (!vault || vault.startsWith('RULES') || vault.startsWith('OFFBOARDING')) break
        vaults.push({
          vault,
          status: (r[1] || '').trim(),
          holds: splitList(r[2]),
          grantTo: splitList(r[3]),
          note: (r[4] || '').trim(),
        })
      }
    }
  }

  return {
    source: 'atlas-csv',
    dir,
    updatedAt: new Date(latestMtime).toISOString(),
    tools,
    roles,
    vaults,
  }
}
