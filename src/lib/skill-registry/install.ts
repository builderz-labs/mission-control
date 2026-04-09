/**
 * Skill install pipeline — fetch from registry, verify hash, security-scan,
 * write to disk, and upsert into the local DB.
 */

import { getErrorMessage } from '../types/sql'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resolveWithin } from '../paths'
import { logger } from '../logger'
import { checkSkillSecurity } from './security'
import {
  fetchClawdHubSkill,
  fetchSkillsShSkill,
  fetchAwesomeOpenclawSkill,
} from './sources'
import type { InstallRequest, InstallResult } from './types'

const SKILL_NAME_RE = /^[a-zA-Z0-9._-]+$/

function skillNameFromSlug(slug: string): string {
  const parts = slug.split('/')
  return parts[parts.length - 1]
}

function getTargetDir(targetRoot: string): string {
  const home = homedir()
  const cwd = process.cwd()
  const openclawState =
    process.env.OPENCLAW_STATE_DIR ||
    process.env.OPENCLAW_HOME ||
    join(home, '.openclaw')

  const rootMap: Record<string, string> = {
    'user-agents': process.env.MC_SKILLS_USER_AGENTS_DIR || join(home, '.agents', 'skills'),
    'user-codex': process.env.MC_SKILLS_USER_CODEX_DIR || join(home, '.codex', 'skills'),
    'project-agents': process.env.MC_SKILLS_PROJECT_AGENTS_DIR || join(cwd, '.agents', 'skills'),
    'project-codex': process.env.MC_SKILLS_PROJECT_CODEX_DIR || join(cwd, '.codex', 'skills'),
    'openclaw': process.env.MC_SKILLS_OPENCLAW_DIR || join(openclawState, 'skills'),
  }

  const dir = rootMap[targetRoot]
  if (!dir) throw new Error(`Invalid target root: ${targetRoot}`)
  return dir
}

async function upsertSkillDb(params: {
  name: string
  targetRoot: string
  skillDir: string
  content: string
  slug: string
  securityStatus: string
}): Promise<void> {
  const { getDatabase } = await import('../db')
  const db = getDatabase()
  const hash = createHash('sha256').update(params.content, 'utf8').digest('hex')
  const now = new Date().toISOString()
  const descLines = params.content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const desc = descLines.find((l) => !l.startsWith('#'))

  db.prepare(`
    INSERT INTO skills (name, source, path, description, content_hash, registry_slug, registry_version, security_status, installed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, name) DO UPDATE SET
      path = excluded.path,
      description = excluded.description,
      content_hash = excluded.content_hash,
      registry_slug = excluded.registry_slug,
      registry_version = excluded.registry_version,
      security_status = excluded.security_status,
      updated_at = excluded.updated_at
  `).run(
    params.name,
    params.targetRoot,
    params.skillDir,
    desc ? (desc.length > 220 ? `${desc.slice(0, 217)}...` : desc) : null,
    hash,
    params.slug,
    'latest',
    params.securityStatus,
    now,
    now
  )
}

export async function installFromRegistry(
  req: InstallRequest
): Promise<InstallResult> {
  const name = skillNameFromSlug(req.slug)
  if (!SKILL_NAME_RE.test(name)) {
    return { ok: false, name, path: '', message: `Invalid skill name: ${name}` }
  }

  const targetDir = getTargetDir(req.targetRoot)
  const skillDir = resolveWithin(targetDir, name)
  const skillDocPath = resolveWithin(skillDir, 'SKILL.md')

  let content: string
  let registryHash: string | undefined

  try {
    if (req.source === 'clawhub') {
      const result = await fetchClawdHubSkill(req.slug)
      content = result.content
      registryHash = result.hash
    } else if (req.source === 'awesome-openclaw') {
      const result = await fetchAwesomeOpenclawSkill(req.slug)
      content = result.content
    } else {
      const result = await fetchSkillsShSkill(req.slug)
      content = result.content
    }
  } catch (err: unknown) {
    return {
      ok: false,
      name,
      path: skillDir,
      message: `Fetch failed: ${getErrorMessage(err)}`,
    }
  }

  if (!content.trim()) {
    return { ok: false, name, path: skillDir, message: 'Registry returned empty content' }
  }

  // SHA-256 verification for ClawdHub (integrity guarantee from the registry)
  if (registryHash) {
    const computed = createHash('sha256').update(content, 'utf8').digest('hex')
    if (computed !== registryHash) {
      return {
        ok: false,
        name,
        path: skillDir,
        message: `SHA-256 mismatch: expected ${registryHash}, got ${computed}. Content may have been tampered with.`,
      }
    }
  }

  const securityReport = checkSkillSecurity(content)
  if (securityReport.status === 'rejected') {
    return {
      ok: false,
      name,
      path: skillDir,
      message: `Security check failed: ${securityReport.issues
        .filter((i) => i.severity === 'critical')
        .map((i) => i.description)
        .join('; ')}`,
      securityReport,
    }
  }

  try {
    await mkdir(skillDir, { recursive: true })
    await writeFile(skillDocPath, content, 'utf8')
  } catch (err: unknown) {
    return {
      ok: false,
      name,
      path: skillDir,
      message: `Write failed: ${getErrorMessage(err)}`,
    }
  }

  try {
    await upsertSkillDb({
      name,
      targetRoot: req.targetRoot,
      skillDir,
      content,
      slug: req.slug,
      securityStatus: securityReport.status,
    })
  } catch (err: unknown) {
    logger.warn({ err }, 'Failed to upsert installed skill into DB')
  }

  return {
    ok: true,
    name,
    path: skillDir,
    message:
      securityReport.issues.length > 0
        ? `Installed with ${securityReport.issues.length} warning(s)`
        : 'Installed successfully',
    securityReport,
  }
}
