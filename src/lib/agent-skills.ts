/**
 * Agent Skills Discovery & Management
 *
 * Discovers skills from multiple sources (global, npm, central, extension, workspace),
 * manages enable/disable state via symlinks, and provides content access.
 */

import path from 'node:path'
import { existsSync, readdirSync, statSync, readFileSync, symlinkSync, unlinkSync, mkdirSync, lstatSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { getAgentWorkspace } from './agent-workspace'

export type SkillSource = 'global' | 'npm' | 'workspace' | 'central' | 'extension'

export interface Skill {
  id: string
  name: string
  description: string
  source: SkillSource
  enabled: boolean
  skillMdPath: string
}

/** Cached openclaw node directory (resolved once per process) */
let _openclawNodeDir: string | null | undefined

/** Resolve the node prefix directory where openclaw is installed */
function getOpenclawNodeDir(): string | null {
  if (_openclawNodeDir !== undefined) return _openclawNodeDir

  try {
    const which = execSync('which openclaw', { encoding: 'utf-8', timeout: 5000 }).trim()
    // which gives: ~/.nvm/versions/node/v24.13.1/bin/openclaw
    // We want: ~/.nvm/versions/node/v24.13.1
    const binDir = path.dirname(which)
    _openclawNodeDir = path.dirname(binDir)
  } catch {
    _openclawNodeDir = null
  }

  return _openclawNodeDir
}

/** Get the npm skills directory for openclaw */
function getOpenclawNpmSkillsDir(): string | null {
  const nodeDir = getOpenclawNodeDir()
  if (!nodeDir) return null
  const dir = path.join(nodeDir, 'lib', 'node_modules', 'openclaw', 'skills')
  return existsSync(dir) ? dir : null
}

/** Get extension skill directories (openclaw extensions that contain skills) */
function getExtensionSkillsDirs(): string[] {
  const nodeDir = getOpenclawNodeDir()
  if (!nodeDir) return []

  const extDir = path.join(nodeDir, 'lib', 'node_modules', 'openclaw', 'extensions')
  if (!existsSync(extDir)) return []

  try {
    return readdirSync(extDir)
      .map(ext => path.join(extDir, ext, 'skills'))
      .filter(d => existsSync(d))
  } catch {
    return []
  }
}

/** Parse YAML frontmatter from SKILL.md */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}

  const yaml = match[1]
  const lines = yaml.split('\n')
  const result: any = {}

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':')
    if (key && valueParts.length) {
      const value = valueParts.join(':').trim()
      result[key.trim()] = value
    }
  }

  return result
}

/** Scan a directory for skills (directories containing SKILL.md) */
function scanSkillsDirectory(dir: string, source: SkillSource): Skill[] {
  if (!existsSync(dir)) return []

  const skills: Skill[] = []

  try {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const entryPath = path.join(dir, entry)
      const skillMdPath = path.join(entryPath, 'SKILL.md')

      // Check if it's a directory (or symlink to directory) with SKILL.md
      if (!existsSync(skillMdPath)) continue

      try {
        const content = readFileSync(skillMdPath, 'utf-8')
        const frontmatter = parseFrontmatter(content)

        skills.push({
          id: entry,
          name: frontmatter.name || entry,
          description: frontmatter.description || '',
          source,
          enabled: false, // Will be determined later
          skillMdPath
        })
      } catch (err) {
        console.warn(`Failed to parse skill ${entry}:`, err)
      }
    }
  } catch (err) {
    console.warn(`Failed to scan skills directory ${dir}:`, err)
  }

  return skills
}

/** Discover all skills from npm, extension, central, global, and workspace locations */
export function discoverSkills(agentWorkspace: string): Skill[] {
  const homeDir = process.env.HOME || '~'

  // Skill source directories
  const npmDir = getOpenclawNpmSkillsDir()
  const extensionDirs = getExtensionSkillsDirs()
  const centralDir = path.join(homeDir, '.agents', 'skills')
  const globalDir = path.join(homeDir, '.openclaw', 'skills')
  const workspaceDir = path.join(agentWorkspace, 'skills')

  // Scan all sources
  const npmSkills = npmDir ? scanSkillsDirectory(npmDir, 'npm') : []
  const extensionSkills = extensionDirs.flatMap(dir => scanSkillsDirectory(dir, 'extension'))
  const centralSkills = scanSkillsDirectory(centralDir, 'central')
  const globalSkills = scanSkillsDirectory(globalDir, 'global')
  const workspaceSkills = scanSkillsDirectory(workspaceDir, 'workspace')

  // Merge and deduplicate (workspace > global > central > extension > npm)
  const skillsMap = new Map<string, Skill>()

  // Add npm skills first (lowest priority)
  for (const skill of npmSkills) {
    skillsMap.set(skill.id, skill)
  }

  // Extension skills
  for (const skill of extensionSkills) {
    skillsMap.set(skill.id, skill)
  }

  // Central skills (~/.agents/skills/)
  for (const skill of centralSkills) {
    skillsMap.set(skill.id, skill)
  }

  // Global skills (~/.openclaw/skills/)
  for (const skill of globalSkills) {
    skillsMap.set(skill.id, skill)
  }

  // Override with workspace skills (highest priority)
  for (const skill of workspaceSkills) {
    skillsMap.set(skill.id, skill)
  }

  // Determine enabled state for each skill
  const skills = Array.from(skillsMap.values())

  // If workspace skills dir doesn't exist, all skills are enabled (OpenClaw default)
  if (!existsSync(workspaceDir)) {
    for (const skill of skills) {
      skill.enabled = true
    }
  } else {
    // Check if each skill exists in the workspace
    for (const skill of skills) {
      const workspaceSkillPath = path.join(workspaceDir, skill.id)
      skill.enabled = existsSync(workspaceSkillPath)
    }
  }

  return skills
}

/** Get all skills for a specific agent by ID */
export function getAgentSkills(agentId: string): Skill[] {
  const workspace = getAgentWorkspace(agentId)
  if (!workspace) return []

  return discoverSkills(workspace)
}

/** Toggle a skill on/off for an agent */
export function toggleSkill(agentId: string, skillId: string, enabled: boolean): { success: boolean; error?: string } {
  const workspace = getAgentWorkspace(agentId)
  if (!workspace) {
    return { success: false, error: 'Agent workspace not found' }
  }

  const workspaceSkillsDir = path.join(workspace, 'skills')
  const targetPath = path.join(workspaceSkillsDir, skillId)

  // Create workspace skills directory if it doesn't exist
  if (!existsSync(workspaceSkillsDir)) {
    try {
      mkdirSync(workspaceSkillsDir, { recursive: true })
    } catch (err) {
      return { success: false, error: `Failed to create skills directory: ${err}` }
    }
  }

  if (enabled) {
    // Enable: create symlink to source skill
    // Find the source skill (exclude workspace since we're symlinking INTO workspace)
    const skills = discoverSkills(workspace)
    const skill = skills.find(s => s.id === skillId && s.source !== 'workspace')
      || skills.find(s => s.id === skillId)

    if (!skill) {
      return { success: false, error: 'Skill not found' }
    }

    // If already exists, nothing to do
    if (existsSync(targetPath)) {
      return { success: true }
    }

    // Get the directory containing SKILL.md
    const sourcePath = path.dirname(skill.skillMdPath)

    try {
      symlinkSync(sourcePath, targetPath, 'dir')
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to create symlink: ${err}` }
    }
  } else {
    // Disable: remove symlink (never delete actual directories)
    if (!existsSync(targetPath)) {
      return { success: true }
    }

    try {
      // Safety check: only remove if it's a symlink
      const stats = lstatSync(targetPath)
      if (stats.isSymbolicLink()) {
        unlinkSync(targetPath)
        return { success: true }
      } else {
        // If it's an actual directory in the workspace, don't delete it
        return { success: false, error: 'Cannot disable workspace-local skill (not a symlink)' }
      }
    } catch (err) {
      return { success: false, error: `Failed to remove symlink: ${err}` }
    }
  }
}

/** Get skill content for viewing/editing */
export function getSkillContent(agentId: string, skillId: string): { content: string; path: string; readOnly: boolean } | { error: string } {
  const workspace = getAgentWorkspace(agentId)
  if (!workspace) {
    return { error: 'Agent workspace not found' }
  }

  const skills = discoverSkills(workspace)
  const skill = skills.find(s => s.id === skillId)

  if (!skill) {
    return { error: 'Skill not found' }
  }

  try {
    const content = readFileSync(skill.skillMdPath, 'utf-8')
    return {
      content,
      path: skill.skillMdPath,
      readOnly: skill.source === 'npm' || skill.source === 'extension'
    }
  } catch (err) {
    return { error: `Failed to read skill content: ${err}` }
  }
}

/** Save skill content (only for non-npm/extension skills) */
export function saveSkillContent(agentId: string, skillId: string, content: string): { success: boolean; error?: string } {
  const workspace = getAgentWorkspace(agentId)
  if (!workspace) {
    return { success: false, error: 'Agent workspace not found' }
  }

  const skills = discoverSkills(workspace)
  const skill = skills.find(s => s.id === skillId)

  if (!skill) {
    return { success: false, error: 'Skill not found' }
  }

  if (skill.source === 'npm' || skill.source === 'extension') {
    return { success: false, error: 'Cannot edit npm/extension skills (read-only)' }
  }

  try {
    const fs = require('fs')
    fs.writeFileSync(skill.skillMdPath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: `Failed to save skill content: ${err}` }
  }
}
