/**
 * Skill Roots — canonical list of filesystem locations where skills are stored.
 *
 * Shared by the API route handler (src/app/api/skills/route.ts) and the
 * background sync worker (src/lib/skill-sync.ts) so discovery logic lives
 * in one place.
 */

import { readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type SkillRoot = { source: string; path: string }

/** Allowlist for per-agent workspace directory names (e.g. "hr", "elyon-2", "hub_v3"). */
const AGENT_NAME_RE = /^[a-z0-9_-]+$/i

function resolveSkillRoot(envName: string, fallback: string): string {
  const override = process.env[envName]
  return override && override.trim().length > 0 ? override.trim() : fallback
}

/**
 * Returns the ordered list of skill roots.
 *
 * Sources are listed from lowest to highest priority. Deduplication in the
 * API route and sync worker honours this order: later sources win when two
 * skills share the same name.
 */
export function getSkillRoots(): SkillRoot[] {
  const home = homedir()
  const cwd = process.cwd()
  const openclawState =
    process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || join(home, '.openclaw')

  const roots: SkillRoot[] = [
    { source: 'user-agents',    path: resolveSkillRoot('MC_SKILLS_USER_AGENTS_DIR',    join(home, '.agents', 'skills')) },
    { source: 'user-codex',     path: resolveSkillRoot('MC_SKILLS_USER_CODEX_DIR',     join(home, '.codex', 'skills')) },
    { source: 'project-agents', path: resolveSkillRoot('MC_SKILLS_PROJECT_AGENTS_DIR', join(cwd, '.agents', 'skills')) },
    { source: 'project-codex',  path: resolveSkillRoot('MC_SKILLS_PROJECT_CODEX_DIR',  join(cwd, '.codex', 'skills')) },
    { source: 'openclaw',       path: resolveSkillRoot('MC_SKILLS_OPENCLAW_DIR',       join(openclawState, 'skills')) },
  ]

  // OpenClaw workspace-local skills
  const workspaceDir =
    process.env.OPENCLAW_WORKSPACE_DIR ||
    process.env.MISSION_CONTROL_WORKSPACE_DIR ||
    join(openclawState, 'workspace')
  roots.push({
    source: 'workspace',
    path: resolveSkillRoot('MC_SKILLS_WORKSPACE_DIR', join(workspaceDir, 'skills')),
  })

  // Dynamic per-agent workspace roots: ~/.openclaw/workspace-<name>/skills/
  try {
    const entries = readdirSync(openclawState, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith('workspace-')) continue

      const agentName = entry.name.slice('workspace-'.length)

      // Validate agent name to prevent path injection via crafted directory names
      if (!AGENT_NAME_RE.test(agentName)) continue

      // Verify the entry is not a symlink — dirent.isDirectory() follows symlinks
      try {
        const stat = lstatSync(join(openclawState, entry.name))
        if (stat.isSymbolicLink()) continue
      } catch {
        continue
      }

      const skillsPath = join(openclawState, entry.name, 'skills')
      roots.push({
        source: `workspace-${agentName}`,
        path: resolveSkillRoot(`MC_SKILLS_WORKSPACE_${agentName.toUpperCase()}_DIR`, skillsPath),
      })
    }
  } catch (err) {
    console.warn('[skill-roots] Failed to scan for workspace-* roots:', err)
  }

  return roots
}
