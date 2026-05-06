/**
 * Claude Code Task & Team Scanner
 *
 * Read-only bridge that discovers Claude Code's:
 * - Team tasks from ~/.claude/tasks/<team>/<N>.json
 * - Team configs from ~/.claude/teams/<name>/config.json
 *
 * Follows the same throttled-scan pattern as claude-sessions.ts.
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { config } from './config'
import { logger } from './logger'

export interface ClaudeCodeTask {
  id: string
  teamName: string
  subject: string
  description: string
  status: string
  owner: string
  blocks: string[]
  blockedBy: string[]
  activeForm?: string
  stale?: boolean
}

export interface ClaudeCodeTeam {
  name: string
  description: string
  createdAt: number
  leadAgentId: string
  members: Array<{
    agentId: string
    name: string
    agentType: string
    model: string
  }>
}

export interface ClaudeCodeScanResult {
  teams: ClaudeCodeTeam[]
  tasks: ClaudeCodeTask[]
}

function safeParse<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function scanTeams(claudeHome: string): ClaudeCodeTeam[] {
  const teamsDir = join(claudeHome, 'teams')
  let teamDirs: string[]
  try {
    teamDirs = readdirSync(teamsDir)
  } catch {
    return []
  }

  const teams: ClaudeCodeTeam[] = []

  for (const teamName of teamDirs) {
    const configPath = join(teamsDir, teamName, 'config.json')
    try {
      if (!statSync(configPath).isFile()) continue
    } catch {
      continue
    }

    const data = safeParse<any>(configPath)
    if (!data?.name) continue

    teams.push({
      name: data.name,
      description: data.description || '',
      createdAt: data.createdAt || 0,
      leadAgentId: data.leadAgentId || '',
      members: Array.isArray(data.members)
        ? data.members.map((m: any) => ({
            agentId: m.agentId || '',
            name: m.name || '',
            agentType: m.agentType || '',
            model: m.model || '',
          }))
        : [],
    })
  }

  return teams
}

function scanTasks(claudeHome: string): ClaudeCodeTask[] {
  const tasksDir = join(claudeHome, 'tasks')
  let teamDirs: string[]
  try {
    teamDirs = readdirSync(tasksDir)
  } catch {
    return []
  }

  const tasks: ClaudeCodeTask[] = []

  for (const teamName of teamDirs) {
    const teamDir = join(tasksDir, teamName)
    try {
      if (!statSync(teamDir).isDirectory()) continue
    } catch {
      continue
    }

    // Skip .lock files, only read JSON task files
    let files: string[]
    try {
      files = readdirSync(teamDir).filter(f => f.endsWith('.json'))
    } catch {
      continue
    }

    for (const file of files) {
      const filePath = join(teamDir, file)
      const data = safeParse<any>(filePath)
      if (!data?.id) continue

      // Detect stale in_progress tasks: file not modified in 60+ minutes
      let stale = false
      if (data.status === 'in_progress') {
        try {
          const mtime = statSync(filePath).mtimeMs
          stale = Date.now() - mtime > 60 * 60 * 1000
        } catch { /* ignore */ }
      }

      tasks.push({
        id: `${teamName}/${data.id}`,
        teamName,
        subject: data.subject || data.title || `Task ${data.id}`,
        description: data.description || '',
        status: data.status || 'unknown',
        owner: data.owner || '',
        blocks: Array.isArray(data.blocks) ? data.blocks : [],
        blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy : [],
        activeForm: data.activeForm,
        stale,
      })
    }
  }

  return tasks
}

export function scanClaudeCodeTasks(): ClaudeCodeScanResult {
  const claudeHome = config.claudeHome
  if (!claudeHome) return { teams: [], tasks: [] }

  return {
    teams: scanTeams(claudeHome),
    tasks: scanTasks(claudeHome),
  }
}

// Throttle full disk scans
let lastScanAt = 0
let cachedResult: ClaudeCodeScanResult = { teams: [], tasks: [] }
const SCAN_THROTTLE_MS = 30_000

export function getClaudeCodeTasks(force = false): ClaudeCodeScanResult {
  const now = Date.now()
  if (!force && lastScanAt > 0 && (now - lastScanAt) < SCAN_THROTTLE_MS) {
    return cachedResult
  }

  try {
    cachedResult = scanClaudeCodeTasks()
    lastScanAt = now
  } catch (err) {
    logger.warn({ err }, 'Claude Code task scan failed')
  }

  return cachedResult
}
