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

    const data = safeParse<Record<string, unknown>>(configPath)
    if (!data?.name) continue

    teams.push({
      name: String(data.name),
      description: typeof data.description === 'string' ? data.description : '',
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      leadAgentId: typeof data.leadAgentId === 'string' ? data.leadAgentId : '',
      members: Array.isArray(data.members)
        ? data.members.map((m: Record<string, unknown>) => ({
            agentId: typeof m.agentId === 'string' ? m.agentId : '',
            name: typeof m.name === 'string' ? m.name : '',
            agentType: typeof m.agentType === 'string' ? m.agentType : '',
            model: typeof m.model === 'string' ? m.model : '',
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
      const data = safeParse<Record<string, unknown>>(join(teamDir, file))
      if (!data?.id) continue

      tasks.push({
        id: `${teamName}/${data.id}`,
        teamName,
        subject: typeof data.subject === 'string' ? data.subject : (typeof data.title === 'string' ? data.title : `Task ${data.id}`),
        description: typeof data.description === 'string' ? data.description : '',
        status: typeof data.status === 'string' ? data.status : 'unknown',
        owner: typeof data.owner === 'string' ? data.owner : '',
        blocks: Array.isArray(data.blocks) ? data.blocks as string[] : [],
        blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy as string[] : [],
        activeForm: typeof data.activeForm === 'string' ? data.activeForm : undefined,
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
