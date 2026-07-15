import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { access, lstat, mkdir, open, readFile, realpath, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'
import { requireRole } from '@/lib/auth'
import { resolveWithin } from '@/lib/paths'
import { checkSkillSecurity } from '@/lib/skill-registry'
import { logAuditEvent } from '@/lib/db'
import { skillMutationLimiter } from '@/lib/rate-limit'
import { skillDeleteSchema, skillMutationSchema, validateBody } from '@/lib/validation'
import { logger } from '@/lib/logger'

interface SkillSummary {
  id: string
  name: string
  source: string
  path: string
  description?: string
  registry_slug?: string | null
  security_status?: string | null
}

type SkillRoot = { source: string; path: string }

class SkillPathError extends Error {}

function auditSkillMutation(
  action: string,
  user: { username: string; id: number },
  source: string,
  name: string,
  detail: Record<string, unknown> = {},
): void {
  try {
    logAuditEvent({
      action,
      actor: user.username,
      actor_id: user.id,
      target_type: 'skill',
      detail: { source, name, ...detail },
    })
  } catch {
    // The filesystem mutation is authoritative; audit storage is best-effort.
  }
}

function resolveSkillRoot(
  envName: string,
  fallback: string,
): string {
  const override = process.env[envName]
  return override && override.trim().length > 0 ? override.trim() : fallback
}

async function pathReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function extractDescription(skillPath: string): Promise<string | undefined> {
  const skillDocPath = join(skillPath, 'SKILL.md')
  if (!(await pathReadable(skillDocPath))) return undefined
  try {
    const content = await readFile(skillDocPath, 'utf8')
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
    const firstParagraph = lines.find((line) => !line.startsWith('#'))
    if (!firstParagraph) return undefined
    return firstParagraph.length > 220 ? `${firstParagraph.slice(0, 217)}...` : firstParagraph
  } catch {
    return undefined
  }
}

async function collectSkillsFromDir(baseDir: string, source: string): Promise<SkillSummary[]> {
  if (!(await pathReadable(baseDir))) return []
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    const out: SkillSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(baseDir, entry.name)
      const skillDocPath = join(skillPath, 'SKILL.md')
      if (!(await pathReadable(skillDocPath))) continue
      out.push({
        id: `${source}:${entry.name}`,
        name: entry.name,
        source,
        path: skillPath,
        description: await extractDescription(skillPath),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function getSkillRoots(): SkillRoot[] {
  const home = homedir()
  const cwd = process.cwd()
  const roots: SkillRoot[] = [
    { source: 'user-agents', path: resolveSkillRoot('MC_SKILLS_USER_AGENTS_DIR', join(home, '.agents', 'skills')) },
    { source: 'user-codex', path: resolveSkillRoot('MC_SKILLS_USER_CODEX_DIR', join(home, '.codex', 'skills')) },
    // Runtime workspace paths are intentionally not statically traced into the
    // standalone artifact. They are operator-managed content, not build input.
    { source: 'project-agents', path: resolveSkillRoot('MC_SKILLS_PROJECT_AGENTS_DIR', `${cwd}/.agents/skills`) },
    { source: 'project-codex', path: resolveSkillRoot('MC_SKILLS_PROJECT_CODEX_DIR', `${cwd}/.codex/skills`) },
  ]
  // Add OpenClaw gateway skill roots when configured
  const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || join(home, '.openclaw')
  const openclawSkills = resolveSkillRoot('MC_SKILLS_OPENCLAW_DIR', join(openclawState, 'skills'))
  roots.push({ source: 'openclaw', path: openclawSkills })

  // Add OpenClaw workspace-local skills (takes precedence when names conflict)
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || process.env.MISSION_CONTROL_WORKSPACE_DIR || join(openclawState, 'workspace')
  const workspaceSkills = resolveSkillRoot('MC_SKILLS_WORKSPACE_DIR', join(workspaceDir, 'skills'))
  roots.push({ source: 'workspace', path: workspaceSkills })

  // Dynamic: scan for workspace-<agent> directories
  try {
    const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs')
    const entries = readdirSync(openclawState) as string[]
    for (const entry of entries) {
      if (!entry.startsWith('workspace-')) continue
      const skillsDir = join(openclawState, entry, 'skills')
      if (existsSync(skillsDir)) {
        const agentName = entry.replace('workspace-', '')
        roots.push({ source: `workspace-${agentName}`, path: skillsDir })
      }
    }
  } catch {
    // openclawBase may not exist
  }

  return roots
}

function normalizeSkillName(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) return null
  return value
}

function getRootBySource(roots: SkillRoot[], sourceRaw: string | null): SkillRoot | null {
  const source = String(sourceRaw || '').trim()
  if (!source) return null
  return roots.find((r) => r.source === source) || null
}

function assertRealPathWithin(rootPath: string, candidatePath: string): void {
  resolveWithin(rootPath, relative(rootPath, candidatePath))
}

async function resolveSafeSkillPaths(root: SkillRoot, name: string, create = false) {
  if (create) await mkdir(root.path, { recursive: true })
  const realRoot = await realpath(root.path).catch(() => null)
  if (!realRoot) throw new SkillPathError('Skill root is unavailable')

  const skillPath = resolveWithin(realRoot, name)
  let skillStat = await lstat(skillPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (skillStat?.isSymbolicLink()) throw new SkillPathError('Symlinked skill directories are not allowed')
  if (skillStat && !skillStat.isDirectory()) throw new SkillPathError('Skill path is not a directory')
  if (!skillStat) {
    if (!create) throw new SkillPathError('Skill not found')
    await mkdir(skillPath, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    skillStat = await lstat(skillPath)
    if (skillStat.isSymbolicLink()) throw new SkillPathError('Symlinked skill directories are not allowed')
    if (!skillStat.isDirectory()) throw new SkillPathError('Skill path is not a directory')
  }

  const realSkillPath = await realpath(skillPath)
  assertRealPathWithin(realRoot, realSkillPath)
  const skillDocPath = resolveWithin(realSkillPath, 'SKILL.md')
  const docStat = await lstat(skillDocPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (docStat?.isSymbolicLink()) throw new SkillPathError('Symlinked skill documents are not allowed')
  if (docStat && !docStat.isFile()) throw new SkillPathError('SKILL.md is not a regular file')

  return { skillPath: realSkillPath, skillDocPath }
}

async function writeSkillDocument(skillPath: string, skillDocPath: string, content: string): Promise<void> {
  const tempPath = resolveWithin(skillPath, `.SKILL.md.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(tempPath, skillDocPath)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function upsertSkill(root: SkillRoot, name: string, content: string) {
  const { skillPath, skillDocPath } = await resolveSafeSkillPaths(root, name, true)
  await writeSkillDocument(skillPath, skillDocPath, content)

  // Update DB hash so next sync cycle detects our write
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const hash = createHash('sha256').update(content, 'utf8').digest('hex')
    const now = new Date().toISOString()
    const descLines = content.split('\n').map(l => l.trim()).filter(Boolean)
    const desc = descLines.find(l => !l.startsWith('#'))
    db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, name) DO UPDATE SET
        path = excluded.path,
        description = excluded.description,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(
      name,
      root.source,
      skillPath,
      desc ? (desc.length > 220 ? `${desc.slice(0, 217)}...` : desc) : null,
      hash,
      now,
      now
    )
  } catch { /* DB not ready yet — sync will catch it */ }

  return { skillPath, skillDocPath }
}

async function deleteSkill(root: SkillRoot, name: string) {
  const { skillPath } = await resolveSafeSkillPaths(root, name)
  await rm(skillPath, { recursive: true, force: true })

  // Remove from DB
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    db.prepare('DELETE FROM skills WHERE source = ? AND name = ?').run(root.source, name)
  } catch { /* best-effort */ }

  return { skillPath }
}

/**
 * Try to serve skill list from DB (fast path).
 * Falls back to filesystem scan if DB has no data yet.
 */
function getSkillsFromDB(): SkillSummary[] | null {
  try {
    const { getDatabase } = require('@/lib/db')
    const db = getDatabase()
    const rows = db.prepare('SELECT name, source, path, description, registry_slug, security_status FROM skills ORDER BY name').all() as Array<{
      name: string; source: string; path: string; description: string | null; registry_slug: string | null; security_status: string | null
    }>
    if (rows.length === 0) return null // DB empty — fall back to fs scan
    return rows.map(r => ({
      id: `${r.source}:${r.name}`,
      name: r.name,
      source: r.source,
      path: r.path,
      description: r.description || undefined,
      registry_slug: r.registry_slug,
      security_status: r.security_status,
    }))
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const roots = getSkillRoots()
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  if (mode === 'content') {
    const source = String(searchParams.get('source') || '')
    const name = normalizeSkillName(String(searchParams.get('name') || ''))
    if (!source || !name) {
      return NextResponse.json({ error: 'source and valid name are required' }, { status: 400 })
    }
    const root = roots.find((r) => r.source === source)
    if (!root) return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    let skillPath: string
    let skillDocPath: string
    try {
      ({ skillPath, skillDocPath } = await resolveSafeSkillPaths(root, name))
    } catch (error) {
      return NextResponse.json({ error: error instanceof SkillPathError ? error.message : 'Skill path is unavailable' }, { status: 404 })
    }
    if (!(await pathReadable(skillDocPath))) return NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 })
    const content = await readFile(skillDocPath, 'utf8')

    // Run security check inline
    const security = checkSkillSecurity(content)

    return NextResponse.json({
      source,
      name,
      skillPath,
      skillDocPath,
      content,
      security,
    })
  }

  if (mode === 'check') {
    // Security-check a specific skill's content
    const source = String(searchParams.get('source') || '')
    const name = normalizeSkillName(String(searchParams.get('name') || ''))
    if (!source || !name) {
      return NextResponse.json({ error: 'source and valid name are required' }, { status: 400 })
    }
    const root = roots.find((r) => r.source === source)
    if (!root) return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    let skillDocPath: string
    try {
      ({ skillDocPath } = await resolveSafeSkillPaths(root, name))
    } catch (error) {
      return NextResponse.json({ error: error instanceof SkillPathError ? error.message : 'Skill path is unavailable' }, { status: 404 })
    }
    if (!(await pathReadable(skillDocPath))) return NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 })
    const content = await readFile(skillDocPath, 'utf8')
    const security = checkSkillSecurity(content)

    // Update DB with security status
    try {
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      db.prepare('UPDATE skills SET security_status = ?, updated_at = ? WHERE source = ? AND name = ?')
        .run(security.status, new Date().toISOString(), source, name)
    } catch { /* best-effort */ }

    return NextResponse.json({ source, name, security })
  }

  // Try DB-backed fast path first
  const dbSkills = getSkillsFromDB()
  if (dbSkills) {
    // Group by source for the groups response
    const groupMap = new Map<string, { source: string; path: string; skills: SkillSummary[] }>()
    for (const root of roots) {
      groupMap.set(root.source, { source: root.source, path: root.path, skills: [] })
    }
    for (const skill of dbSkills) {
      // Dynamically add workspace-* groups not already in roots
      if (!groupMap.has(skill.source) && skill.source.startsWith('workspace-')) {
        groupMap.set(skill.source, { source: skill.source, path: '', skills: [] })
      }
      const group = groupMap.get(skill.source)
      if (group) group.skills.push(skill)
    }

    const deduped = new Map<string, SkillSummary>()
    for (const skill of dbSkills) {
      if (!deduped.has(skill.name)) deduped.set(skill.name, skill)
    }

    return NextResponse.json({
      skills: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)),
      groups: Array.from(groupMap.values()),
      total: deduped.size,
    })
  }

  // Fallback: filesystem scan (first load before sync runs)
  const bySource = await Promise.all(
    roots.map(async (root) => ({
      source: root.source,
      path: root.path,
      skills: await collectSkillsFromDir(root.path, root.source),
    }))
  )

  const all = bySource.flatMap((group) => group.skills)
  const deduped = new Map<string, SkillSummary>()
  for (const skill of all) {
    if (!deduped.has(skill.name)) deduped.set(skill.name, skill)
  }

  return NextResponse.json({
    skills: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)),
    groups: bySource,
    total: deduped.size,
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}`
  const limited = skillMutationLimiter(limitKey)
  if (limited) return limited

  const validated = await validateBody(request, skillMutationSchema)
  if ('error' in validated) return validated.error

  const roots = getSkillRoots()
  const root = getRootBySource(roots, validated.data.source)
  const name = normalizeSkillName(validated.data.name)
  const contentRaw = validated.data.content
  const content = contentRaw.trim() || `# ${name || 'skill'}\n\nDescribe this skill.\n`

  if (!root || !name) {
    return NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 })
  }

  const security = checkSkillSecurity(content)
  if (security.status === 'rejected') {
    return NextResponse.json({ error: 'Skill content failed security checks', security }, { status: 422 })
  }

  try {
    const { skillPath, skillDocPath } = await upsertSkill(root, name, content)
    auditSkillMutation('skill.upsert', auth.user, root.source, name, { security_status: security.status })
    return NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath, security })
  } catch (error) {
    logger.error({ actor: auth.user.username, source: root.source, name, err: error }, 'Skill creation failed')
    const message = error instanceof SkillPathError ? error.message : 'Failed to create skill'
    return NextResponse.json({ error: message }, { status: error instanceof SkillPathError ? 400 : 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}`
  const limited = skillMutationLimiter(limitKey)
  if (limited) return limited

  const validated = await validateBody(request, skillMutationSchema)
  if ('error' in validated) return validated.error

  const roots = getSkillRoots()
  const root = getRootBySource(roots, validated.data.source)
  const name = normalizeSkillName(validated.data.name)
  const content = validated.data.content

  if (!root || !name) {
    return NextResponse.json({ error: 'Valid source, name, and content are required' }, { status: 400 })
  }

  const security = checkSkillSecurity(content)
  if (security.status === 'rejected') {
    return NextResponse.json({ error: 'Skill content failed security checks', security }, { status: 422 })
  }

  try {
    const { skillPath, skillDocPath } = await upsertSkill(root, name, content)
    auditSkillMutation('skill.update', auth.user, root.source, name, { security_status: security.status })
    return NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath, security })
  } catch (error) {
    logger.error({ actor: auth.user.username, source: root.source, name, err: error }, 'Skill update failed')
    const message = error instanceof SkillPathError ? error.message : 'Failed to update skill'
    return NextResponse.json({ error: message }, { status: error instanceof SkillPathError ? 400 : 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}`
  const limited = skillMutationLimiter(limitKey)
  if (limited) return limited

  const validated = await validateBody(request, skillDeleteSchema)
  if ('error' in validated) return validated.error

  const roots = getSkillRoots()
  const root = getRootBySource(roots, validated.data.source)
  const name = normalizeSkillName(validated.data.name)
  if (!root || !name) {
    return NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 })
  }

  try {
    const { skillPath } = await deleteSkill(root, name)
    auditSkillMutation('skill.delete', auth.user, root.source, name)
    return NextResponse.json({ ok: true, source: root.source, name, skillPath })
  } catch (error) {
    logger.error({ actor: auth.user.username, source: root.source, name, err: error }, 'Skill deletion failed')
    const message = error instanceof SkillPathError ? error.message : 'Failed to delete skill'
    return NextResponse.json({ error: message }, { status: error instanceof SkillPathError ? 400 : 500 })
  }
}

export const dynamic = 'force-dynamic'
