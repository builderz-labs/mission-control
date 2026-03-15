import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { config } from './config'
import { logger } from './logger'
import { getDatabase } from './db'

import { ClaudeSessionRow, GitHealth, ProjectHealth, RoadmapPhase, RoadmapTask } from '@/types'

/**
 * Executes git commands to determine repo health.
 */
export function getGitHealth(projectPath: string): GitHealth | null {
  try {
    if (!fs.existsSync(path.join(projectPath, '.git'))) {
      return null
    }

    const exec = (cmd: string) => {
      try {
        return execSync(cmd, { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch {
        return null
      }
    }

    const branch = exec('git branch --show-current')
    const commitHash = exec('git rev-parse HEAD')
    
    // Status parsing
    const statusOutput = exec('git status --porcelain') || ''
    const statusLines = statusOutput.split('\n').filter(Boolean)
    const isDirty = statusLines.some(l => !l.startsWith('??'))
    const untrackedCount = statusLines.filter(l => l.startsWith('??')).length
    const stagedCount = statusLines.filter(l => l[0] !== ' ' && l[0] !== '?' && l[0] !== ' ').length

    // Ahead/Behind (only if remote is set)
    let aheadBy = 0
    let behindBy = 0
    try {
      const ab = exec('git rev-list --left-right --count HEAD...@{u}')
      if (ab) {
        const [ahead, behind] = ab.split('\t').map(Number)
        aheadBy = ahead || 0
        behindBy = behind || 0
      }
    } catch {
      // No upstream or other error
    }

    // Last commit time
    const lastCommitAtStr = exec('git log -1 --format=%ct')
    const lastCommitAt = lastCommitAtStr ? parseInt(lastCommitAtStr, 10) : null

    return {
      branch,
      commitHash,
      isDirty,
      aheadBy,
      behindBy,
      untrackedCount,
      stagedCount,
      lastCommitAt
    }
  } catch (err) {
    logger.warn({ err, projectPath }, 'Failed to get git health')
    return null
  }
}

/**
 * Scans a project directory for task.md and returns health metrics.
 */
export function getProjectHealth(projectName: keyof typeof config.projects): ProjectHealth {
  const projectPath = config.projects[projectName]
  const health: ProjectHealth = {
    name: projectName.toUpperCase(),
    path: projectPath,
    status: 'unknown',
    progress: 0,
    lastUpdated: null,
    tasks: { total: 0, completed: 0 },
    roadmapFocus: 'General Development',
    currentPhase: 'Maintenance'
  }

  try {
    if (!fs.existsSync(projectPath)) {
      return health
    }

    health.git = getGitHealth(projectPath) || undefined

    const taskMdPath = path.join(projectPath, 'task.md')
    if (fs.existsSync(taskMdPath)) {
      const content = fs.readFileSync(taskMdPath, 'utf-8')
      const stats = parseTaskMd(content)
      health.tasks = { total: stats.total, completed: stats.completed }
      health.progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
      health.roadmapFocus = stats.roadmapFocus
      health.currentPhase = stats.currentPhase
      health.roadmap = stats.roadmap
      
      const stat = fs.statSync(taskMdPath)
      health.lastUpdated = stat.mtime.toISOString()
      
      // Determine activity based on last modified time (active if changed in last 24h)
      const isRecent = (Date.now() - stat.mtimeMs) < 24 * 60 * 60 * 1000
      health.status = isRecent ? 'active' : 'inactive'
    } else {
      // Fallback for projects without task.md
      const stat = fs.statSync(projectPath)
      health.lastUpdated = stat.mtime.toISOString()
      health.status = 'active'
    }

    // V13: Infrastructure Synthesis - Inject live session mapping
    const db = getDatabase()
    const activeSessions = db.prepare(`
      SELECT session_id FROM claude_sessions 
      WHERE project_slug = ? AND is_active = 1
    `).all(projectName.toLowerCase()) as { session_id: string }[]

    health.activeSessionCount = activeSessions.length
    health.activeSessionIds = activeSessions.map(s => s.session_id)
  } catch (err) {
    logger.error({ err, projectPath }, 'Failed to track project health')
  }

  return health
}

/**
 * Enhanced parser for task.md to count tasks and synthesize roadmap with hierarchy.
 */
function parseTaskMd(content: string): { 
  total: number, 
  completed: number, 
  roadmapFocus: string, 
  currentPhase: string,
  roadmap: RoadmapPhase[]
} {
  const lines = content.split('\n')
  let total = 0
  let completed = 0
  let roadmapFocus = 'Initial Alignment'
  let currentPhase = 'Discovery'
  let foundUncompleted = false
  
  const roadmap: RoadmapPhase[] = []
  let currentPhaseObj: RoadmapPhase | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    const indent = line.search(/\S/)
    
    // Header detection (Roadmap Phases)
    if (trimmed.startsWith('#')) {
      const name = trimmed.replace(/^#+\s*/, '')
      
      // Update overall focus/phase logic
      if (!foundUncompleted) {
        roadmapFocus = name
        currentPhase = name
      }

      currentPhaseObj = {
        name,
        status: 'todo',
        progress: 0,
        tasks: []
      }
      roadmap.push(currentPhaseObj)
      continue
    }

    const isTask = trimmed.startsWith('- [ ]') || trimmed.startsWith('- [/]') || trimmed.startsWith('- [x]')
    if (isTask) {
      const isDone = trimmed.startsWith('- [x]')
      const name = trimmed.substring(6).trim()
      const status = isDone ? 'done' : (trimmed.startsWith('- [/]') ? 'in_progress' : 'todo')

      total++
      if (isDone) completed++
      else foundUncompleted = true

      if (currentPhaseObj) {
        currentPhaseObj.tasks.push({
          name,
          status,
          indent
        })
      }
    }
  }

  // Post-process phases to calculate progress and baseline status
  roadmap.forEach(phase => {
    const phaseTotal = phase.tasks.length
    const phaseDone = phase.tasks.filter(t => t.status === 'done').length
    const phaseInProgress = phase.tasks.filter(t => t.status === 'in_progress').length
    
    phase.progress = phaseTotal > 0 ? Math.round((phaseDone / phaseTotal) * 100) : 0
    if (phase.progress === 100) phase.status = 'done'
    else if (phaseInProgress > 0 || phase.progress > 0) phase.status = 'in_progress'
    else phase.status = 'todo'
  })

  return { total, completed, roadmapFocus, currentPhase, roadmap }
}

/**
 * Syncs git health for all projects into the database.
 */
export async function syncGitHealth(): Promise<void> {
  const db = getDatabase()
  const projects = Object.keys(config.projects)
  const now = Math.floor(Date.now() / 1000)

  const upsert = db.prepare(`
    INSERT INTO git_health (
      project_slug, branch, commit_hash, is_dirty,
      ahead_by, behind_by, untracked_count, staged_count,
      last_commit_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_slug, workspace_id) DO UPDATE SET
      branch = excluded.branch,
      commit_hash = excluded.commit_hash,
      is_dirty = excluded.is_dirty,
      ahead_by = excluded.ahead_by,
      behind_by = excluded.behind_by,
      untracked_count = excluded.untracked_count,
      staged_count = excluded.staged_count,
      last_commit_at = excluded.last_commit_at,
      updated_at = excluded.updated_at
  `)

  db.transaction(() => {
    for (const name of projects) {
      const git = getGitHealth(config.projects[name as keyof typeof config.projects])
      if (git) {
        upsert.run(
          name.toLowerCase(), git.branch, git.commitHash, git.isDirty ? 1 : 0,
          git.aheadBy, git.behindBy, git.untrackedCount, git.stagedCount,
          git.lastCommitAt, now
        )
      }
    }
  })()
}

/**
 * Tracks health of all configured projects.
 */
export function trackAllProjects(): ProjectHealth[] {
  return Object.keys(config.projects).map(name => getProjectHealth(name as keyof typeof config.projects))
}

/**
 * Calculates project velocity based on task completion activity over time.
 */
export function calculateProjectVelocity(projectSlug: string, days: number = 7): number {
  const db = getDatabase()
  const cutoff = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60)
  
  // Count tasks completed in the specified window
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM activities
    WHERE type = 'task_completed' 
    AND (description LIKE ? OR entity_id IN (SELECT id FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE slug = ?)))
    AND created_at > ?
  `).get(`%[${projectSlug.toUpperCase()}]%`, projectSlug.toLowerCase(), cutoff) as { count: number }

  return row ? row.count / days : 0
}
/**
 * Updates the status of a specific task in the project's task.md file.
 * Marks the task as [x] (done), [/] (in_progress), or [ ] (todo).
 */
export function updateTaskMdStatus(projectName: string, taskName: string, status: 'done' | 'in_progress' | 'todo'): boolean {
  const projectPath = config.projects[projectName as keyof typeof config.projects]
  if (!projectPath) return false

  const taskMdPath = path.join(projectPath, 'task.md')
  if (!fs.existsSync(taskMdPath)) return false

  try {
    const content = fs.readFileSync(taskMdPath, 'utf-8')
    const lines = content.split('\n')
    
    let updated = false
    const newLines = lines.map(line => {
      const trimmed = line.trim()
      if ((trimmed.startsWith('- [ ]') || trimmed.startsWith('- [/]') || trimmed.startsWith('- [x]')) && trimmed.includes(taskName)) {
        updated = true
        const prefix = status === 'done' ? '- [x]' : (status === 'in_progress' ? '- [/]' : '- [ ]')
        return line.replace(/- \[[ x/]\]/, prefix)
      }
      return line
    })

    if (updated) {
      fs.writeFileSync(taskMdPath, newLines.join('\n'), 'utf-8')
      logger.info({ projectName, taskName, status }, 'Updated task.md status')
      return true
    }
    
    return false
  } catch (err) {
    logger.error({ err, projectPath }, 'Failed to update task.md status')
    return false
  }
}
/**
 * Verifies if an AI task has been successfully completed based on session telemetry.
 * Returns true if the session is stable and has high tool success.
 */
export function verifyTaskSuccess(session: ClaudeSessionRow): { success: boolean, confidence: number, reason: string } {
  const stability = session.stability_score ?? 100
  const successes = session.tool_success_count ?? 0
  const errors = session.tool_error_count ?? 0
  const toolScore = successes / (successes + errors || 1)

  if (stability < 80) {
    return { success: false, confidence: 0.2, reason: `Stability score (${Math.round(stability)}%) is below the Aegis V16 threshold (80%).` }
  }

  if (toolScore < 0.9) {
    return { success: false, confidence: 0.4, reason: `Tool success ratio (${Math.round(toolScore * 100)}%) indicates potential underlying issues.` }
  }

  if ((session.total_loc_delta ?? 0) === 0 && session.user_messages > 5) {
    return { success: false, confidence: 0.3, reason: 'High activity with zero line-of-code impact detected.' }
  }

  return {
    success: true,
    confidence: Math.round(stability * toolScore),
    reason: 'Forensic telemetry confirms high-quality execution and stability.'
  }
}
