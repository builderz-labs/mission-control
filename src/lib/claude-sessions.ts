/**
 * Claude Code Local Session Scanner
 *
 * Discovers and tracks local Claude Code sessions by scanning ~/.claude/projects/.
 * Each project directory contains JSONL session transcripts that record every
 * user message, assistant response, and tool call with timestamps and token usage.
 *
 * This module parses those JSONL files to extract:
 * - Session metadata (model, project, git branch, timestamps)
 * - Message counts (user, assistant, tool uses)
 * - Token usage (input, output, estimated cost)
 * - Activity status (active if last message < 5 minutes ago)
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { config } from './config'
import { getDatabase } from './db'
import { logger } from './logger'

// Rough per-token pricing (USD) for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
}

const DEFAULT_PRICING = { input: 3 / 1_000_000, output: 15 / 1_000_000 }

// Session is "active" if last message was within this window
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000

interface SessionStats {
  sessionId: string
  projectSlug: string
  projectPath: string | null
  model: string | null
  gitBranch: string | null
  userMessages: number
  assistantMessages: number
  toolUses: number
  toolSuccesses: number
  toolErrors: number
  totalLocDelta: number
  locByLanguage: Record<string, number>
  errorDensity: number
  stabilityScore: number
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  lastUserPrompt: string | null
  isActive: boolean
  alertStatus: 'nominal' | 'warning' | 'critical'
  isSidechain: boolean
  toolTimeline: Array<{ name: string; status: 'success' | 'error'; timestamp: string }>
  parentSessionId: string | null
  intentTask: string | null
  area: 'backend' | 'frontend' | 'infra' | 'unknown'
  historyStability: number[]
  isAnomaly: boolean
}

interface JSONLEntry {
  type?: string
  sessionId?: string
  timestamp?: string
  isSidechain?: boolean
  gitBranch?: string
  cwd?: string
  message?: {
    role?: string
    content?: string | Array<{ 
      type: string; 
      text?: string; 
      id?: string;
      name?: string;
      input?: any;
    }>
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  toolUseId?: string
  output?: string
  isError?: boolean
}

/** Parse a single JSONL file and extract session stats */
export function parseSessionFile(filePath: string, projectSlug: string): SessionStats | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)

    if (lines.length === 0) return null

    let sessionId: string | null = null
    let model: string | null = null
    let gitBranch: string | null = null
    let projectPath: string | null = null
    let userMessages = 0
    let assistantMessages = 0
    let toolUses = 0
    let toolSuccesses = 0
    let toolErrors = 0
    let totalLocDelta = 0
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0
    let firstMessageAt: string | null = null
    let lastMessageAt: string | null = null
    let lastUserPrompt: string | null = null
    const locByLanguage: Record<string, number> = {}
    const toolTimeline: Array<{ name: string; status: 'success' | 'error'; timestamp: string }> = []
    let isSidechain = false
    let parentSessionId: string | null = null
    let intentTask: string | null = null

    const getExt = (p?: string): string => {
      if (!p) return 'unknown'
      const ext = p.split('.').pop()?.toLowerCase() || 'unknown'
      return ext.length > 5 ? 'unknown' : ext
    }

    // Map tool use IDs to tracking data for LoC and success correlation
    const pendingTools = new Map<string, { name: string, loc: number, lang: string }>()

    for (const line of lines) {
      let entry: JSONLEntry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      // Extract session ID from first entry that has one
      if (!sessionId && entry.sessionId) {
        sessionId = entry.sessionId
      }

      // Extract git branch
      if (!gitBranch && entry.gitBranch) {
        gitBranch = entry.gitBranch
      }

      // Extract sidechain / parent info
      if (entry.isSidechain !== undefined) {
        isSidechain = entry.isSidechain
      }

      // Extract project working directory
      if (!projectPath && entry.cwd) {
        projectPath = entry.cwd
      }

      // Track timestamps
      if (entry.timestamp) {
        if (!firstMessageAt) firstMessageAt = entry.timestamp
        lastMessageAt = entry.timestamp
      }

      // Track tool results (from user/system messages or specific tool result entries)
      if (entry.type === 'tool_result' || (entry.toolUseId && entry.output !== undefined)) {
        const id = entry.toolUseId
        if (id && pendingTools.has(id)) {
          const tool = pendingTools.get(id)!
          if (entry.isError) {
            toolErrors++
            toolTimeline.push({ name: tool.name, status: 'error', timestamp: entry.timestamp || lastMessageAt || '' })
          } else {
            toolSuccesses++
            totalLocDelta += tool.loc
            locByLanguage[tool.lang] = (locByLanguage[tool.lang] || 0) + tool.loc
            toolTimeline.push({ name: tool.name, status: 'success', timestamp: entry.timestamp || lastMessageAt || '' })
          }
          pendingTools.delete(id)
        }
      }

      // Track user messages and tool results within them
      if (entry.type === 'user' && entry.message) {
        if (!entry.isSidechain) userMessages++

        const msg = entry.message
        if (typeof msg.content === 'string' && msg.content.length > 0) {
          if (!entry.isSidechain) {
            lastUserPrompt = msg.content.slice(0, 500)
          } else if (!intentTask) {
            // First user message in a sidechain is usually the delegated task
            intentTask = msg.content.slice(0, 500)
          }
        } else if (Array.isArray(msg.content)) {
          // Look for tool results in content blocks
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              const id = ((block as Record<string, unknown>).tool_use_id || block.id) as string | undefined
              if (id && pendingTools.has(id)) {
                const tool = pendingTools.get(id)!
                const isError = block.text?.includes('Error:') || (block as Record<string, unknown>).isError || (block as Record<string, unknown>).is_error
                if (isError) {
                  toolErrors++
                  toolTimeline.push({ name: tool.name, status: 'error', timestamp: entry.timestamp || lastMessageAt || '' })
                } else {
                  toolSuccesses++
                  totalLocDelta += tool.loc
                  locByLanguage[tool.lang] = (locByLanguage[tool.lang] || 0) + tool.loc
                  toolTimeline.push({ name: tool.name, status: 'success', timestamp: entry.timestamp || lastMessageAt || '' })
                }
                pendingTools.delete(id)
              }
            }
          }
        }
      }

      if (entry.type === 'assistant' && entry.message) {
        if (!entry.isSidechain) assistantMessages++

        // Extract model
        if (entry.message.model) {
          model = entry.message.model
        }

        // Extract token usage
        const usage = entry.message.usage
        if (usage) {
          inputTokens += (usage.input_tokens || 0)
          cacheReadTokens += (usage.cache_read_input_tokens || 0)
          cacheCreationTokens += (usage.cache_creation_input_tokens || 0)
          outputTokens += (usage.output_tokens || 0)
        }

        // Count tool uses in assistant content
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_use') {
              toolUses++
              
              const input = block.input || {}
              let locDelta = 0
              let lang = 'unknown'

              // Language detection
              if (input.filePath || input.path || input.filename) {
                lang = getExt(input.filePath || input.path || input.filename)
              }

              // 1. Handle Edit tool (replacements array)
              if (Array.isArray(input.replacements)) {
                for (const rep of input.replacements) {
                  const content = rep.replacementContent || rep.replacement || ''
                  if (typeof content === 'string' && content.length > 0) {
                    locDelta += content.split('\n').length
                  }
                }
              } 
              // 2. Handle simple content/replacement fields (Write / str_replace)
              else {
                const content = input.content || input.replacement || input.text || input.code || ''
                if (typeof content === 'string' && content.length > 0) {
                  locDelta = content.split('\n').length
                }

                // 3. Handle Bash commands (capture redirects/heredocs)
                if (block.name === 'Bash' && typeof input.command === 'string') {
                  // Heuristic: if command contains a heredoc or large redirect, count lines
                  const cmd = input.command
                  if (cmd.includes('<<') || cmd.includes('>')) {
                    locDelta = Math.max(locDelta, cmd.split('\n').length - 1)
                  }
                }
              }

              if (block.id) {
                pendingTools.set(block.id, { name: block.name || 'unknown', loc: locDelta, lang })
              }
            }
          }
        }
      }
    }

    if (!sessionId) return null

    // Estimate cost (cache reads = 10% of input, cache creation = 125% of input)
    const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING
    const estimatedCost =
      inputTokens * pricing.input +
      cacheReadTokens * pricing.input * 0.1 +
      cacheCreationTokens * pricing.input * 1.25 +
      outputTokens * pricing.output

    // Determine if active
    const isActive = lastMessageAt
      ? (Date.now() - new Date(lastMessageAt).getTime()) < ACTIVE_THRESHOLD_MS
      : false

    // Store total input tokens (including cache) for display
    const totalInputTokens = inputTokens + cacheReadTokens + cacheCreationTokens

    // Calculate stability
    const totalToolResolutions = toolSuccesses + toolErrors
    const errorDensity = totalToolResolutions > 0 ? (toolErrors / totalToolResolutions) : 0
    const stabilityScore = Math.max(0, 100 - (errorDensity * 200)) // 0% errors = 100, 50% errors = 0

    // Aegis Alerting Thresholds
    let alertStatus: 'nominal' | 'warning' | 'critical' = 'nominal'
    if (stabilityScore < 50) alertStatus = 'critical'
    else if (stabilityScore < 75) alertStatus = 'warning'
    
    // Auto-Area Detection (Hardened V14.0)
    let area: 'backend' | 'frontend' | 'infra' | 'unknown' = 'unknown'
    
    const frontendHits = (locByLanguage['tsx'] || 0) + (locByLanguage['css'] || 0) + (locByLanguage['html'] || 0)
    const backendHits = (locByLanguage['ts'] || 0) + (locByLanguage['js'] || 0) + (locByLanguage['py'] || 0)
    const infraHits = (locByLanguage['sql'] || 0) + (locByLanguage['yaml'] || 0) + (locByLanguage['yml'] || 0) + (locByLanguage['sh'] || 0)

    if (frontendHits > backendHits && frontendHits > infraHits) area = 'frontend'
    else if (backendHits > frontendHits && backendHits > infraHits) area = 'backend'
    else if (infraHits > frontendHits && infraHits > backendHits) area = 'infra'
    else {
      // Fallback: Path-based detection for read-only or mixed sessions
      const allPaths = lines.map(l => {
        try { return JSON.parse(l)?.cwd || '' } catch { return '' }
      }).join(' ') + (projectPath || '')
      
      if (allPaths.includes('/components') || allPaths.includes('/app') || allPaths.includes('/ui')) area = 'frontend'
      else if (allPaths.includes('/api') || allPaths.includes('/lib') || allPaths.includes('/server')) area = 'backend'
      else if (allPaths.includes('/infra') || allPaths.includes('/scripts') || allPaths.includes('/deploy')) area = 'infra'
    }

    // Calculate stability trend (last 10 snapshots)
    const historyStability: number[] = []
    if (toolTimeline.length > 0) {
      const windowSize = Math.max(1, Math.floor(toolTimeline.length / 10))
      for (let i = 0; i < 10; i++) {
        const end = Math.min(toolTimeline.length, (i + 1) * windowSize)
        const slice = toolTimeline.slice(0, end)
        const successes = slice.filter(t => t.status === 'success').length
        const total = slice.length
        const score = total > 0 ? Math.max(0, 100 - ((total - successes) / total * 200)) : 100
        historyStability.push(Math.round(score))
      }
    } else {
      historyStability.push(100)
    }

    // V15: Anomaly Detection
    const isAnomaly = detectStabilityAnomaly(projectSlug, stabilityScore, historyStability)

    return {
      sessionId,
      projectSlug,
      projectPath,
      model,
      gitBranch,
      userMessages,
      assistantMessages,
      toolUses,
      toolSuccesses,
      toolErrors,
      totalLocDelta,
      locByLanguage,
      errorDensity,
      stabilityScore,
      inputTokens: totalInputTokens,
      outputTokens,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      firstMessageAt,
      lastMessageAt,
      lastUserPrompt,
      isActive,
      alertStatus,
      isSidechain,
      toolTimeline,
      parentSessionId,
      intentTask,
      area,
      historyStability: historyStability.slice(-50), // Cap at 50 for V15
      isAnomaly,
    }
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to parse Claude session file')
    return null
  }
}

/** Scan all Claude Code projects and discover sessions */
export function scanClaudeSessions(since: number = 0): SessionStats[] {
  const claudeHome = config.claudeHome
  if (!claudeHome) return []

  const projectsDir = join(claudeHome, 'projects')
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(projectsDir)
  } catch {
    return [] // No projects directory — Claude Code not installed or never used
  }

  const sessions: SessionStats[] = []

  const findJsonl = (dir: string): string[] => {
    let results: string[] = []
    try {
      const list = readdirSync(dir)
      for (const file of list) {
        const fullPath = join(dir, file)
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          results = results.concat(findJsonl(fullPath))
        } else if (file.endsWith('.jsonl')) {
          // Optimization: skip if file not modified since last scan
          // (allowing 5m overlap for active sessions)
          if (stat.mtimeMs / 1000 > (since - 300)) {
            results.push(fullPath)
          }
        }
      }
    } catch {
      // Skip inaccessible paths
    }
    return results
  }

  for (const projectSlug of projectDirs) {
    const projectDir = join(projectsDir, projectSlug)

    let stat
    try {
      stat = statSync(projectDir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue

    const files = findJsonl(projectDir)
    for (const filePath of files) {
      const parsed = parseSessionFile(filePath, projectSlug)
      if (parsed) sessions.push(parsed)
    }
  }

  // Phase 2: Map sidechains to parents based on proximity and CWD
  sessions.forEach(s => {
    if (s.isSidechain && !s.parentSessionId && s.firstMessageAt) {
      const sTime = new Date(s.firstMessageAt).getTime()
      const potentialParents = sessions
        .filter(p => !p.isSidechain && p.projectPath === s.projectPath && p.lastMessageAt)
        .map(p => ({ id: p.sessionId, time: new Date(p.lastMessageAt!).getTime() }))
        .filter(p => p.time <= sTime && (sTime - p.time) < 60000)
        .sort((a, b) => b.time - a.time)

      if (potentialParents.length > 0) {
        s.parentSessionId = potentialParents[0].id
      }
    }
  })

  return sessions
}

/** Scan and upsert sessions into the database */
export async function syncClaudeSessions(sinceOverride?: number): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    
    // Get last scan time for incremental sync, or use override
    let since = sinceOverride
    if (since === undefined) {
      const lastScanRow = db.prepare('SELECT MAX(scanned_at) as last_scan FROM claude_sessions').get() as { last_scan: number | null }
      since = lastScanRow?.last_scan || 0
    }

    const sessions = scanClaudeSessions(since)
    if (sessions.length === 0) {
      return { ok: true, message: `No new sessions since ${new Date(since * 1000).toLocaleString()}` }
    }

    const now = Math.floor(Date.now() / 1000)

    const upsert = db.prepare(`
      INSERT INTO claude_sessions (
        session_id, project_slug, project_path, model, git_branch,
        user_messages, assistant_messages, tool_uses,
        tool_success_count, tool_error_count, total_loc_delta,
        loc_by_language, error_density, stability_score,
        alert_status, is_sidechain, tool_timeline, parent_session_id, intent_task,
        input_tokens, output_tokens, estimated_cost,
        first_message_at, last_message_at, last_user_prompt,
        is_active, scanned_at, updated_at, history_stability, area, is_anomaly
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        model = excluded.model,
        git_branch = excluded.git_branch,
        user_messages = excluded.user_messages,
        assistant_messages = excluded.assistant_messages,
        tool_uses = excluded.tool_uses,
        tool_success_count = excluded.tool_success_count,
        tool_error_count = excluded.tool_error_count,
        total_loc_delta = excluded.total_loc_delta,
        loc_by_language = excluded.loc_by_language,
        error_density = excluded.error_density,
        stability_score = excluded.stability_score,
        alert_status = excluded.alert_status,
        is_sidechain = excluded.is_sidechain,
        tool_timeline = excluded.tool_timeline,
        parent_session_id = excluded.parent_session_id,
        intent_task = excluded.intent_task,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        estimated_cost = excluded.estimated_cost,
        last_message_at = excluded.last_message_at,
        last_user_prompt = excluded.last_user_prompt,
        is_active = excluded.is_active,
        scanned_at = excluded.scanned_at,
        updated_at = excluded.updated_at,
        history_stability = excluded.history_stability,
        area = excluded.area,
        is_anomaly = excluded.is_anomaly
    `)

    let upserted = 0
    db.transaction(() => {
      // Mark all sessions inactive before scanning ONLY IF we are doing a full fresh scan 
      // or if we want to ensure only current scan results are active.
      // For incremental, we'll mark inactive those we just updated if they aren't active.
      
      for (const s of sessions) {
        upsert.run(
          s.sessionId, s.projectSlug, s.projectPath, s.model, s.gitBranch,
          s.userMessages, s.assistantMessages, s.toolUses,
          s.toolSuccesses, s.toolErrors, s.totalLocDelta,
          JSON.stringify(s.locByLanguage), s.errorDensity, s.stabilityScore,
          s.alertStatus, s.isSidechain ? 1 : 0, JSON.stringify(s.toolTimeline), s.parentSessionId, s.intentTask,
          s.inputTokens, s.outputTokens, s.estimatedCost,
          s.firstMessageAt, s.lastMessageAt, s.lastUserPrompt,
          s.isActive ? 1 : 0, now, now, JSON.stringify(s.historyStability), s.area,
          s.isAnomaly ? 1 : 0
        )
        upserted++
      }
    })()

    const active = sessions.filter(s => s.isActive).length
    return {
      ok: true,
      message: `Updated ${upserted} session(s) since last sync, ${active} active`,
    }
  } catch (err: any) {
    logger.error({ err }, 'Claude session sync failed')
    return { ok: false, message: `Scan failed: ${err.message}` }
  }
}

/** Calculate projected daily spend based on token velocity */
export async function getBurnForecast(): Promise<{ todayActual: number; todayProjected: number; velocity: number }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const morning = new Date()
    morning.setHours(0, 0, 0, 0)
    const startOfDay = Math.floor(morning.getTime() / 1000)

    // 1. Get total cost so far today
    const sessionsToday = db.prepare(`
      SELECT estimated_cost, first_message_at, last_message_at
      FROM claude_sessions
      WHERE (strftime('%s', last_message_at) >= ?) OR (scanned_at >= ?)
    `).all(startOfDay, startOfDay) as Array<{ estimated_cost: number, first_message_at: string, last_message_at: string }>

    const todayActual = sessionsToday.reduce((sum, s) => sum + s.estimated_cost, 0)

    // 2. Calculate velocity (cost per hour) over the active window today
    const hoursElapsed = (now - startOfDay) / 3600
    const velocity = hoursElapsed > 0 ? (todayActual / hoursElapsed) : 0

    // 3. Project for the rest of the day (24 hours total)
    const hoursRemaining = Math.max(0, 24 - hoursElapsed)
    const todayProjected = todayActual + (velocity * hoursRemaining)

    return {
      todayActual: Math.round(todayActual * 100) / 100,
      todayProjected: Math.round(todayProjected * 100) / 100,
      velocity: Math.round(velocity * 10000) / 10000
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to calculate burn forecast')
    return { todayActual: 0, todayProjected: 0, velocity: 0 }
  }
}

/**
 * Detects if a session's stability is an anomaly compared to project mean.
 */
function detectStabilityAnomaly(projectSlug: string, currentStability: number, trend: number[]): boolean {
  if (trend.length < 5) return false // Need some history to detect anomaly

  const db = getDatabase()
  const meanRow = db.prepare(`
    SELECT AVG(stability_score) as avg_stability FROM (
      SELECT stability_score FROM claude_sessions 
      WHERE project_slug = ? AND stability_score > 0
      ORDER BY last_message_at DESC LIMIT 100
    )
  `).get(projectSlug) as { avg_stability: number } | undefined

  const projectMean = meanRow?.avg_stability || 90
  
  // Anomaly if current stability is 20 points below project mean OR dropping rapidly
  if (currentStability < (projectMean - 20)) return true
  
  const recentTrend = trend.slice(-5)
  const isDropping = recentTrend[0] > currentStability + 30
  
  return isDropping
}
