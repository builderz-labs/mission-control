import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type SkillRoot = { source: string; path: string }

export const LOCAL_SKILL_SOURCES = [
  'user-agents', 'user-codex', 'user-claude', 'user-grok', 'user-kimi',
  'project-agents', 'project-codex', 'openclaw', 'workspace',
]

export const SKILL_INSTALL_TARGETS = [
  'user-agents', 'user-codex', 'user-claude', 'user-grok', 'user-kimi',
  'project-agents', 'project-codex', 'openclaw', 'workspace',
] as const

export function skillTargetDir(targetRoot: string): string {
  const home = homedir()
  const cwd = process.cwd()
  const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || join(home, '.openclaw')
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR
    || process.env.MISSION_CONTROL_WORKSPACE_DIR
    || join(openclawState, 'workspace')
  const rootMap: Record<string, string> = {
    'user-agents': envPath('MC_SKILLS_USER_AGENTS_DIR', join(home, '.agents', 'skills')),
    'user-codex': envPath('MC_SKILLS_USER_CODEX_DIR', join(home, '.codex', 'skills')),
    'user-claude': envPath('MC_SKILLS_USER_CLAUDE_DIR', join(home, '.claude', 'skills')),
    'user-grok': envPath('MC_SKILLS_USER_GROK_DIR', join(home, '.grok', 'skills')),
    'user-kimi': envPath('MC_SKILLS_USER_KIMI_DIR', join(home, '.kimi-code', 'skills')),
    'project-agents': envPath('MC_SKILLS_PROJECT_AGENTS_DIR', join(cwd, '.agents', 'skills')),
    'project-codex': envPath('MC_SKILLS_PROJECT_CODEX_DIR', join(cwd, '.codex', 'skills')),
    'openclaw': envPath('MC_SKILLS_OPENCLAW_DIR', join(openclawState, 'skills')),
    'workspace': envPath('MC_SKILLS_WORKSPACE_DIR', join(workspaceDir, 'skills')),
  }
  const dir = rootMap[targetRoot]
  if (!dir) throw new Error(`Invalid target root: ${targetRoot}`)
  return dir
}

function envPath(name: string, fallback: string): string {
  const override = process.env[name]
  return override && override.trim() ? override.trim() : fallback
}

export function listSkillRoots(): SkillRoot[] {
  const home = homedir()
  const cwd = process.cwd()
  const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || join(home, '.openclaw')
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR
    || process.env.MISSION_CONTROL_WORKSPACE_DIR
    || join(openclawState, 'workspace')
  const roots: SkillRoot[] = [
    { source: 'user-agents', path: envPath('MC_SKILLS_USER_AGENTS_DIR', join(home, '.agents', 'skills')) },
    { source: 'user-codex', path: envPath('MC_SKILLS_USER_CODEX_DIR', join(home, '.codex', 'skills')) },
    { source: 'user-claude', path: envPath('MC_SKILLS_USER_CLAUDE_DIR', join(home, '.claude', 'skills')) },
    { source: 'user-grok', path: envPath('MC_SKILLS_USER_GROK_DIR', join(home, '.grok', 'skills')) },
    { source: 'user-kimi', path: envPath('MC_SKILLS_USER_KIMI_DIR', join(home, '.kimi-code', 'skills')) },
    { source: 'project-agents', path: envPath('MC_SKILLS_PROJECT_AGENTS_DIR', join(cwd, '.agents', 'skills')) },
    { source: 'project-codex', path: envPath('MC_SKILLS_PROJECT_CODEX_DIR', join(cwd, '.codex', 'skills')) },
    { source: 'openclaw', path: envPath('MC_SKILLS_OPENCLAW_DIR', join(openclawState, 'skills')) },
    { source: 'workspace', path: envPath('MC_SKILLS_WORKSPACE_DIR', join(workspaceDir, 'skills')) },
  ]
  try {
    for (const entry of readdirSync(openclawState)) {
      if (!entry.startsWith('workspace-')) continue
      const skillsDir = join(openclawState, entry, 'skills')
      if (existsSync(skillsDir)) {
        roots.push({ source: `workspace-${entry.slice('workspace-'.length)}`, path: skillsDir })
      }
    }
  } catch {
    // openclaw state may not exist
  }
  const seen = new Set<string>()
  return roots.filter((root) => {
    if (!existsSync(root.path)) return false
    try {
      const real = realpathSync(root.path)
      if (seen.has(real)) return false
      seen.add(real)
      return true
    } catch {
      return false
    }
  })
}

export const ALIAS_SKILL_SOURCES = [
  'user-codex', 'user-claude', 'user-grok', 'user-kimi', 'openclaw',
] as const

export function listExtraSkillRoots(): SkillRoot[] {
  const home = homedir()
  const extra: SkillRoot[] = [
    { source: 'grok-bundled', path: join(home, '.grok', 'bundled', 'skills') },
    { source: 'openclaw-plugin', path: join(home, '.openclaw', 'plugin-skills') },
  ]
  return extra.filter((root) => existsSync(root.path))
}
