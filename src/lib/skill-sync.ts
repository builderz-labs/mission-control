/**
 * Skill Sync — Bidirectional disk ↔ DB synchronization for agent skills.
 *
 * Scans 5 skill roots for directories containing SKILL.md, hashes content,
 * and upserts into the `skills` DB table.  UI edits write through to disk
 * and update the content hash so the next sync cycle skips them.
 *
 * Conflict policy: **disk wins** when both sides change between syncs.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDatabase } from './db'
import { logger } from './logger'
import { parseSkillDescription } from './skill-frontmatter'
import { ALIAS_SKILL_SOURCES, LOCAL_SKILL_SOURCES, listExtraSkillRoots, listSkillRoots } from './skill-roots'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillRow {
  id: number
  name: string
  source: string
  path: string
  description: string | null
  content_hash: string | null
  registry_slug: string | null
  registry_version: string | null
  security_status: string | null
  installed_at: string
  updated_at: string
}

interface DiskSkill {
  name: string
  source: string
  path: string
  description: string | undefined
  contentHash: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function getSkillRoots() {
  return [...listSkillRoots(), ...listExtraSkillRoots()]
}

// ---------------------------------------------------------------------------
// Disk scanner
// ---------------------------------------------------------------------------

function scanDiskSkills(): DiskSkill[] {
  const skills: DiskSkill[] = []
  for (const root of getSkillRoots()) {
    if (!existsSync(root.path)) continue
    let entries: string[]
    try {
      entries = readdirSync(root.path)
    } catch {
      continue
    }
    for (const entry of entries) {
      const skillPath = join(root.path, entry)
      try {
        if (!statSync(skillPath).isDirectory()) continue
      } catch {
        continue
      }
      const skillDoc = join(skillPath, 'SKILL.md')
      if (!existsSync(skillDoc)) continue
      try {
        const content = readFileSync(skillDoc, 'utf8')
        skills.push({
          name: entry,
          source: root.source,
          path: skillPath,
          description: parseSkillDescription(content),
          contentHash: sha256(content),
        })
      } catch {
        // Unreadable — skip
      }
    }
  }
  return skills
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

export async function syncSkillsFromDisk(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const diskSkills = scanDiskSkills()
    const now = new Date().toISOString()

    // Build a lookup of what's on disk
    const diskMap = new Map<string, DiskSkill>()
    for (const s of diskSkills) {
      diskMap.set(`${s.source}:${s.name}`, s)
    }

    // Fetch current DB rows (only local sources, not registry-installed via slug)
    const localSources = [...LOCAL_SKILL_SOURCES, 'grok-bundled', 'openclaw-plugin']
    // Also include any dynamic workspace-* sources from disk
    for (const s of diskSkills) {
      if (s.source.startsWith('workspace-') && !localSources.includes(s.source)) {
        localSources.push(s.source)
      }
    }
    const dbRows = db.prepare(
      `SELECT * FROM skills WHERE source IN (${localSources.map(() => '?').join(',')})`
    ).all(...localSources) as SkillRow[]

    const dbMap = new Map<string, SkillRow>()
    for (const r of dbRows) {
      dbMap.set(`${r.source}:${r.name}`, r)
    }

    let created = 0
    let updated = 0
    let deleted = 0

    const insertStmt = db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const updateStmt = db.prepare(`
      UPDATE skills SET path = ?, description = ?, content_hash = ?, updated_at = ?
      WHERE source = ? AND name = ?
    `)
    const deleteStmt = db.prepare(`DELETE FROM skills WHERE source = ? AND name = ?`)

    db.transaction(() => {
      // Disk → DB: additions and changes
      for (const [key, disk] of diskMap) {
        const existing = dbMap.get(key)
        if (!existing) {
          insertStmt.run(disk.name, disk.source, disk.path, disk.description || null, disk.contentHash, now, now)
          created++
        } else if (
          existing.content_hash !== disk.contentHash
          || existing.description !== (disk.description || null)
        ) {
          // Disk wins: content or parsed description changed since last sync
          updateStmt.run(disk.path, disk.description || null, disk.contentHash, now, disk.source, disk.name)
          updated++
        }
      }

      for (const source of ALIAS_SKILL_SOURCES) {
        const gone = db.prepare(
          'DELETE FROM skills WHERE source = ? AND registry_slug IS NULL',
        ).run(source)
        deleted += Number(gone.changes || 0)
      }

      // DB → Disk: detect removals (skill deleted from disk since last sync)
      for (const [key, row] of dbMap) {
        if (!diskMap.has(key) && !row.registry_slug) {
          // Only auto-delete non-registry skills that vanished from disk
          deleteStmt.run(row.source, row.name)
          deleted++
        }
      }
    })()

    const msg = `Skill sync: ${created} added, ${updated} updated, ${deleted} removed (${diskSkills.length} on disk)`
    if (created > 0 || updated > 0 || deleted > 0) {
      logger.info(msg)
    }
    return { ok: true, message: msg }
  } catch (err: any) {
    logger.error({ err }, 'Skill sync failed')
    return { ok: false, message: `Skill sync failed: ${err.message}` }
  }
}
