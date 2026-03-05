/**
 * Agent Workspace Resolver
 *
 * Reads/writes markdown files from an agent's workspace directory on disk.
 * Workspace paths come from openclaw.json → agents.list[].workspace,
 * stored in the MC database as agents.config.workspace.
 */

import path from 'node:path'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { getDatabase } from './db'

/** Files that are allowed to be accessed via the files API */
const ALLOWED_ROOT_FILES = new Set([
  'SOUL.md',
  'MEMORY.md',
  'AGENTS.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'SYSTEMS.md',
  'PROJECTS.md',
  'HEARTBEAT.md',
])

/** Validate that a resolved path stays within the workspace */
function assertWithinWorkspace(workspace: string, resolved: string): void {
  const base = path.resolve(workspace)
  const target = path.resolve(resolved)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path escapes workspace directory')
  }
}

/** Resolve an agent's workspace path from DB config (by name or numeric id) */
export function getAgentWorkspace(agentNameOrId: string): string | null {
  const db = getDatabase()
  let agent: any
  if (isNaN(Number(agentNameOrId))) {
    agent = db.prepare('SELECT config FROM agents WHERE name = ?').get(agentNameOrId)
  } else {
    agent = db.prepare('SELECT config FROM agents WHERE id = ?').get(Number(agentNameOrId))
  }
  if (!agent?.config) return null

  try {
    const cfg = typeof agent.config === 'string' ? JSON.parse(agent.config) : agent.config
    return cfg.workspace || null
  } catch {
    return null
  }
}

/** List all .md files in the workspace root */
export function listWorkspaceFiles(workspace: string): Array<{
  filename: string
  size: number
  modified: number
}> {
  const dir = path.resolve(workspace)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fullPath = path.join(dir, f)
      const stat = statSync(fullPath)
      return {
        filename: f,
        size: stat.size,
        modified: Math.floor(stat.mtimeMs / 1000),
      }
    })
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

/** Read a specific file from the workspace. Returns null if not found. */
export function readWorkspaceFile(workspace: string, filename: string): string | null {
  const resolved = path.resolve(workspace, filename)
  assertWithinWorkspace(workspace, resolved)

  if (!existsSync(resolved)) return null
  return readFileSync(resolved, 'utf-8')
}

/** Write a specific file to the workspace. Creates parent dirs if needed. */
export function writeWorkspaceFile(workspace: string, filename: string, content: string): void {
  const resolved = path.resolve(workspace, filename)
  assertWithinWorkspace(workspace, resolved)

  const dir = path.dirname(resolved)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(resolved, content, 'utf-8')
}

/** List daily memory files from workspace/memory/ */
export function listMemoryFiles(workspace: string): Array<{
  filename: string
  date: string
  size: number
  modified: number
}> {
  const memDir = path.resolve(workspace, 'memory')
  if (!existsSync(memDir)) return []

  return readdirSync(memDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fullPath = path.join(memDir, f)
      const stat = statSync(fullPath)
      return {
        filename: `memory/${f}`,
        date: f.replace('.md', ''),
        size: stat.size,
        modified: Math.floor(stat.mtimeMs / 1000),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date)) // newest first
}

/** Check if a filename is in the allowed whitelist for the files API */
export function isAllowedFile(filename: string): boolean {
  // Root-level whitelisted files
  if (ALLOWED_ROOT_FILES.has(filename)) return true

  // memory/*.md files
  if (filename.startsWith('memory/') && filename.endsWith('.md')) {
    const basename = path.basename(filename)
    // Only alphanumeric, dashes, dots in the basename (e.g. 2026-03-01.md)
    if (/^[\w.-]+\.md$/.test(basename)) return true
  }

  return false
}
