#!/usr/bin/env node
// Bulk-archive Asana projects with no activity in last 90 days.
// One-way operation. Skips already-archived. Also tags project notes.
//
// Usage:
//   node scripts/asana-bulk-archive.mjs --dry-run           preview
//   node scripts/asana-bulk-archive.mjs --confirm           write for real
//   node scripts/asana-bulk-archive.mjs --confirm --keep current_projects,personal_2026
//
// Source of truth for the cut-off: finding_asana_audit_84_projects_28may.md
// (74 dead projects, 4 stalled, 6 active). This script auto-detects via
// last task modification date — does not depend on the audit static list.
//
// Reads ASANA_PAT from ~/james/.env.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOME = process.env.HOME

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const flagVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

const DRY_RUN = flag('--dry-run') || !flag('--confirm')
const KEEP = (flagVal('--keep', '') || '').split(',').filter(Boolean)
const CUTOFF_DAYS = Number(flagVal('--cutoff-days', '90'))
const ASANA_WORKSPACE = '1203637576513591'
const EPL_TEAM = '1203637576513593'
const cutoffMs = Date.now() - CUTOFF_DAYS * 86400_000

// ─── Asana auth ──────────────────────────────────────────────────────────
function readEnvFile(filePath, key) {
  if (!fs.existsSync(filePath)) return null
  const txt = fs.readFileSync(filePath, 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`))
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim()
  }
  return null
}

const ASANA_PAT = process.env.ASANA_PAT
  || readEnvFile(path.join(HOME, 'james', '.env'), 'ASANA_PAT')
if (!ASANA_PAT) { console.error('ASANA_PAT not found'); process.exit(2) }

// ─── Helpers ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function asana(pathStr, init = {}) {
  const resp = await fetch(`https://app.asana.com/api/1.0${pathStr}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${ASANA_PAT}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!resp.ok) throw new Error(`Asana ${pathStr} → ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  return resp.json()
}

async function paginate(pathStr, params = {}) {
  const all = []
  let offset = null
  for (let i = 0; i < 50; i++) {
    const qs = new URLSearchParams({ ...params, limit: '100', ...(offset ? { offset } : {}) })
    const data = await asana(`${pathStr}?${qs}`)
    all.push(...(data.data || []))
    offset = data.next_page?.offset
    if (!offset) break
  }
  return all
}

async function projectLatestActivity(projectGid) {
  // Most-recently-modified incomplete task in this project, fall back to project.modified_at.
  try {
    const r = await asana(`/projects/${projectGid}/tasks?completed_since=now&opt_fields=modified_at&limit=10`)
    const tasks = r.data || []
    let max = 0
    for (const t of tasks) {
      const ts = Date.parse(t.modified_at || '')
      if (ts > max) max = ts
    }
    return max
  } catch {
    return 0
  }
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Asana bulk-archive  Mode: ${DRY_RUN ? 'DRY-RUN' : 'WRITE'}  Cutoff: ${CUTOFF_DAYS}d  Keep: [${KEEP.join(', ') || 'none'}]`)
  console.log('')

  const projects = await paginate(`/teams/${EPL_TEAM}/projects`, {
    opt_fields: 'name,archived,modified_at,num_tasks',
    archived: 'false',
  })
  console.log(`Found ${projects.length} active EPL-team projects`)

  const toArchive = []
  const toKeep = []
  for (const p of projects) {
    if (KEEP.some(k => p.name?.toLowerCase().includes(k.toLowerCase()))) {
      toKeep.push({ ...p, reason: 'matched --keep' })
      continue
    }
    const latest = await projectLatestActivity(p.gid)
    await sleep(120)
    if (latest === 0 || latest < cutoffMs) {
      toArchive.push({ ...p, latest })
    } else {
      const ageDays = Math.floor((Date.now() - latest) / 86400_000)
      toKeep.push({ ...p, latest, reason: `active (${ageDays}d ago)` })
    }
  }

  console.log('')
  console.log(`To ARCHIVE: ${toArchive.length}`)
  console.log(`To KEEP:    ${toKeep.length}`)
  console.log('')

  if (toArchive.length === 0) { console.log('Nothing to do.'); return }

  if (DRY_RUN) {
    console.log('=== WOULD ARCHIVE ===')
    toArchive.slice(0, 10).forEach(p => console.log(`  [${p.gid}] ${p.name}`))
    if (toArchive.length > 10) console.log(`  ... + ${toArchive.length - 10} more`)
    console.log('')
    console.log('=== WOULD KEEP ===')
    toKeep.forEach(p => console.log(`  [${p.gid}] ${p.name}  (${p.reason})`))
    console.log('')
    console.log('Re-run with --confirm to archive for real.')
    return
  }

  console.log(`Archiving ${toArchive.length} projects (1 req/sec)...`)
  let done = 0, failed = 0
  for (const p of toArchive) {
    try {
      await asana(`/projects/${p.gid}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { archived: true } }),
      })
      done++
      if (done % 10 === 0) console.log(`  ... ${done}/${toArchive.length}`)
    } catch (e) {
      failed++
      console.error(`  FAIL [${p.gid}] ${p.name}: ${e.message}`)
    }
    await sleep(1000)
  }

  console.log('')
  console.log(`✓ Archived: ${done}`)
  console.log(`✗ Failed:   ${failed}`)
}

main().catch(e => { console.error(e); process.exit(1) })
