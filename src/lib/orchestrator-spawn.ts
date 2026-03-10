import { spawn, spawnSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname, basename, extname, normalize } from 'path'
import { getDatabase, logAuditEvent } from './db'
import { logger } from './logger'
import { config } from './config'
import {
  getLearningMemorySuggestions,
  getReferencePackSuggestions,
  writeAgentLearningMemory,
  writeProjectLearningMemory,
} from './orchestrator-reference-pack'
import { mergeTaskProgressMetadata } from './task-progress'
import {
  captureWorkspaceSnapshot,
  findWorkspaceRootFromPath,
  verifyTaskExecution,
  type WorkspaceSnapshot,
} from './task-verification'

// ─── TASK TYPE DETECTION & MODEL SELECTION ────────────────────────────────────

export type TaskType = 'coding' | 'writing' | 'analysis' | 'devops' | 'research' | 'general'

const TASK_KEYWORDS: Record<TaskType, string[]> = {
  coding:   ['fix', 'bug', 'implement', 'refactor', 'function', 'api', 'test', 'code', 'script', 'error', 'crash', 'debug', 'feature', 'class', 'module', 'compile', 'build', 'typescript', 'javascript', 'python'],
  writing:  ['write', 'document', 'readme', 'docs', 'comment', 'explain', 'describe', 'summary', 'report', 'changelog', 'guide', 'tutorial', 'draft'],
  analysis: ['analyze', 'review', 'audit', 'check', 'inspect', 'evaluate', 'assess', 'performance', 'security', 'quality', 'scan', 'profile', 'diagnose'],
  devops:   ['deploy', 'docker', 'pipeline', 'server', 'config', 'setup', 'install', 'migrate', 'database', 'infra', 'ci', 'cd', 'kubernetes', 'helm', 'terraform', 'nginx'],
  research: ['research', 'find', 'search', 'investigate', 'explore', 'compare', 'benchmark', 'discover', 'survey', 'gather'],
  general:  [],
}

/** Groq model IDs mapped to task type — pick best capability vs speed trade-off */
const MODEL_MAP: Record<TaskType, string> = {
  coding:   'llama-3.3-70b-versatile',
  writing:  'llama-3.1-8b-instant',
  analysis: 'llama-3.3-70b-versatile',
  devops:   'llama-3.3-70b-versatile',
  research: 'llama-3.1-70b-versatile',
  general:  'llama3-8b-8192',
}

/** Classify a task description into a TaskType based on keyword scoring */
export function detectTaskType(text: string): TaskType {
  const lower = text.toLowerCase()
  let best: TaskType = 'general'
  let bestScore = 0
  for (const [type, keywords] of Object.entries(TASK_KEYWORDS) as [TaskType, string[]][]) {
    if (type === 'general') continue
    const score = keywords.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = type }
  }
  return best
}

/** Return the best Groq model ID for a given task type */
export function selectModel(taskType: TaskType): string {
  return MODEL_MAP[taskType] ?? MODEL_MAP.general
}

function parseEnvFile(filePath: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  const content = readFileSync(filePath, 'utf8')

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    if (!key) continue

    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    parsed[key] = value
  }

  return parsed
}

// ─── FILE SUGGESTION ──────────────────────────────────────────────────────────

interface SuggestedFile {
  path: string
  name: string
  reason: string // Why this file is suggested
  priority: number // Lower = higher priority
  source?: 'project' | 'reference-pack' | 'learned-memory'
}

const IGNORED_SUGGESTION_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vercel',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
  'temp',
  'logs',
  'vendor',
])

const MAX_SUGGESTION_DIRS = 180
const MAX_SUGGESTION_FILES = 600
const MAX_SIBLING_DIRS = 8
const SUGGESTION_CACHE_TTL_MS = 15_000

const suggestionCache = new Map<string, { expiresAt: number; files: SuggestedFile[] }>()

function getOrchestratorContextSettings() {
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT key, value FROM settings
      WHERE key IN ('orchestrator.auto_attach_reference_pack', 'orchestrator.auto_attach_learned_memory')
    `).all() as Array<{ key: string; value: string }>
    const values = new Map(rows.map((row) => [row.key, row.value]))
    return {
      autoAttachReferencePack: values.get('orchestrator.auto_attach_reference_pack') !== 'false',
      autoAttachLearnedMemory: values.get('orchestrator.auto_attach_learned_memory') !== 'false',
    }
  } catch {
    return {
      autoAttachReferencePack: true,
      autoAttachLearnedMemory: true,
    }
  }
}

/** Suggest up to 10 relevant files from the project folder and nearby workspace dirs */
export function suggestProjectFiles(folder: string, taskContext?: string): SuggestedFile[] {
  const contextSettings = getOrchestratorContextSettings()
  const taskHint = (taskContext || '').trim().toLowerCase().slice(0, 160)
  const cacheKey = [
    normalize(folder),
    taskHint,
    contextSettings.autoAttachReferencePack ? 'pack:on' : 'pack:off',
    contextSettings.autoAttachLearnedMemory ? 'memory:on' : 'memory:off',
  ].join('|')
  const cached = suggestionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.files.map((file) => ({ ...file }))
  }

  const results: SuggestedFile[] = []
  const seen = new Set<string>()
  const scanBudget = {
    dirs: 0,
    files: 0,
    siblingDirs: 0,
  }

  // Patterns that indicate high-value files for the orchestrator
  const HIGH_PRIORITY_NAMES = ['todo', 'task', 'plan', 'errorreport', 'error-report', 'report', 'spec', 'requirements', 'backlog', 'roadmap', 'milestone', 'sprint', 'fixlist']
  const MID_PRIORITY_NAMES  = ['readme', 'changelog', 'notes', 'issues', 'status', 'summary', 'overview', 'architecture', 'design', 'schema', 'api', 'config', 'setup']
  const ALLOWED_EXT = new Set(['.md', '.txt', '.json', '.log', '.csv', '.yaml', '.yml', '.toml'])

  function scoreFile(filePath: string): SuggestedFile | null {
    if (seen.has(filePath)) return null
    seen.add(filePath)
    const name = basename(filePath).toLowerCase()
    const ext  = extname(filePath).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) return null
    try { if (!existsSync(filePath)) return null } catch { return null }

    const nameNoExt = name.replace(/\.[^.]+$/, '')
    const isHigh = HIGH_PRIORITY_NAMES.some(p => nameNoExt.includes(p))
    const isMid  = MID_PRIORITY_NAMES.some(p => nameNoExt.includes(p))

    let priority = isHigh ? 10 : isMid ? 20 : 30
    // Boost files in root / doc dirs
    const rel = filePath.replace(folder, '').replace(/\\/g, '/')
    if (!rel.includes('/output/') && !rel.includes('/node_modules/') && !rel.includes('/.git/')) {
      priority -= 5
    }

    let reason = isHigh ? `📋 Task/plan file` : isMid ? `📝 Project notes` : `📄 Reference`
    if (nameNoExt.includes('error') || nameNoExt.includes('report')) reason = '🐛 Error report'
    else if (nameNoExt.includes('todo') || nameNoExt.includes('task')) reason = '✅ Task list'
    else if (nameNoExt.includes('plan') || nameNoExt.includes('spec')) reason = '🏗️ Plan/spec'

    // Recency boost: files modified within 7 days
    try {
      const mtime = statSync(filePath).mtimeMs
      if (Date.now() - mtime < 7 * 86400 * 1000) priority -= 3
    } catch { /* ignore */ }

    return { path: filePath, name: basename(filePath), reason, priority, source: 'project' }
  }

  function scanDir(dir: string, maxDepth: number) {
    if (maxDepth < 0 || scanBudget.dirs >= MAX_SUGGESTION_DIRS || scanBudget.files >= MAX_SUGGESTION_FILES) return
    try {
      scanBudget.dirs += 1
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (scanBudget.files >= MAX_SUGGESTION_FILES) break
        const full = join(dir, entry.name)
        if (entry.name.startsWith('.') || IGNORED_SUGGESTION_DIRS.has(entry.name.toLowerCase()) || entry.name === 'output') continue
        if (entry.isFile()) {
          scanBudget.files += 1
          const scored = scoreFile(full)
          if (scored) results.push(scored)
        } else if (entry.isDirectory() && maxDepth > 0) {
          scanDir(full, maxDepth - 1)
        }
      }
    } catch { /* ignore permission errors */ }
  }

  // Scan: 1) orchestrator project folder (depth 2)
  scanDir(folder, 2)

  // Scan: 2) a few likely sibling projects only when task context suggests external task docs
  const shouldScanSiblings = /(todo|task|plan|spec|report|error|backlog|roadmap|status|review)/i.test(taskHint)
  if (shouldScanSiblings) {
    const parentDir = dirname(folder)
    try {
      for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
        if (scanBudget.siblingDirs >= MAX_SIBLING_DIRS) break
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.') || IGNORED_SUGGESTION_DIRS.has(entry.name.toLowerCase())) continue
        const siblingDir = join(parentDir, entry.name)
        if (siblingDir === folder) continue
        scanBudget.siblingDirs += 1
        scanDir(siblingDir, 1)
      }
    } catch { /* ignore */ }
  }

  const curatedFiles = [
    ...(contextSettings.autoAttachLearnedMemory ? getLearningMemorySuggestions(folder, taskContext) : []),
    ...(contextSettings.autoAttachReferencePack ? getReferencePackSuggestions() : []),
  ]

  for (const file of curatedFiles) {
    const scored = scoreFile(file.path)
    if (scored) {
      scored.reason = file.reason
      scored.priority = Math.min(scored.priority, file.priority)
      scored.source = file.source
      results.push(scored)
    }
  }

  // Sort by priority, return top 10
  results.sort((a, b) => a.priority - b.priority)
  const finalResults = results.slice(0, 10)
  suggestionCache.set(cacheKey, {
    expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
    files: finalResults.map((file) => ({ ...file })),
  })
  return finalResults
}

/** Recursively collect all file paths under a dir (depth ≤ 4) */
export function listFiles(dir: string, depth = 0): string[] {
  if (depth > 3) return []
  const out: string[] = []
  try {
    const { readdirSync: rd } = require('fs')
    for (const entry of rd(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isFile()) out.push(full)
      else if (entry.isDirectory()) out.push(...listFiles(full, depth + 1))
    }
  } catch { /* ignore permission errors */ }
  return out
}

function parseTaskMetadata(raw: unknown): Record<string, any> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {}
}

function resolveTaskWorkspaceRoot(taskId?: number | null, fallbackFolder?: string) {
  const db = getDatabase()

  if (taskId) {
    const row = db.prepare(`SELECT metadata FROM tasks WHERE id = ?`).get(taskId) as { metadata?: string | null } | undefined
    const metadata = parseTaskMetadata(row?.metadata)
    if (typeof metadata.workspace_root === 'string' && metadata.workspace_root && existsSync(metadata.workspace_root)) {
      return metadata.workspace_root
    }
    if (typeof metadata.source_file === 'string' && metadata.source_file) {
      return findWorkspaceRootFromPath(metadata.source_file)
    }
  }

  return fallbackFolder || process.cwd()
}

function markStaleOrchestratorRuns(projectId: number, now: number, staleAfterSeconds = 300) {
  const db = getDatabase()
  const staleRuns = db.prepare(`
    SELECT id, task_id
    FROM orchestrator_runs
    WHERE project_id = ?
      AND status = 'running'
      AND started_at <= ?
      AND (output IS NULL OR trim(output) = '')
  `).all(projectId, now - staleAfterSeconds) as Array<{ id: number; task_id: number | null }>

  for (const run of staleRuns) {
    db.prepare(`
      UPDATE orchestrator_runs
      SET status = 'failed',
          error = ?,
          completed_at = ?
      WHERE id = ?
    `).run('Marked stale after no output was produced', now, run.id)

    if (run.task_id) {
      const taskRow = db.prepare(`SELECT status, created_at, updated_at, estimated_hours, actual_hours, metadata FROM tasks WHERE id = ?`).get(run.task_id) as any
      const currentMetadata = parseTaskMetadata(taskRow?.metadata)
      const nextStatus = taskRow?.status === 'review' || taskRow?.status === 'quality_review' ? taskRow.status : 'inbox'
      const nextMetadata = mergeTaskProgressMetadata({
        status: taskRow?.status || nextStatus,
        created_at: taskRow?.created_at || now,
        updated_at: taskRow?.updated_at || now,
        estimated_hours: taskRow?.estimated_hours,
        actual_hours: taskRow?.actual_hours,
        metadata: currentMetadata,
      }, nextStatus, now, {
        ...currentMetadata,
        verification: {
          ...(currentMetadata.verification || {}),
          checked_at: now,
          passed: false,
          reason: 'Previous orchestrator fallback run was marked stale after producing no output',
        },
      })
      db.prepare(`UPDATE tasks SET status = ?, assigned_to = NULL, metadata = ?, updated_at = ? WHERE id = ?`)
        .run(nextStatus, JSON.stringify(nextMetadata), now, run.task_id)
    }
  }
}

// ─── POST-RUN PIPELINE ────────────────────────────────────────────────────────

/** Rule-based audit: grades a run 0–10, returns score + audit note lines. Zero AI tokens. */
function auditRun(output: string, exitCode: number, files: string[], elapsedSec: number) {
  const lines: string[] = []
  let grade = 0

  // Exit code (3 pts)
  if (exitCode === 0) {
    grade += 3
    lines.push('✅ Exit 0 — completed successfully (+3)')
  } else {
    lines.push(`❌ Exit ${exitCode} — process failed (+0)`)
  }

  // Files generated (up to 3 pts)
  if (files.length === 0) {
    lines.push('⚠️ No output files generated (+0)')
  } else if (files.length < 3) {
    grade += 2
    lines.push(`✅ ${files.length} output file(s) generated (+2)`)
  } else {
    grade += 3
    lines.push(`✅ ${files.length} output files generated (+3)`)
  }

  // Exception / traceback detection (1 pt)
  const hasException = /\b(exception|traceback|uncaught|fatal error|unhandled rejection)\b/i.test(output)
  if (!hasException) {
    grade += 1
    lines.push('✅ No exceptions/tracebacks detected (+1)')
  } else {
    lines.push('⚠️ Exception or traceback found in output (+0)')
  }

  // Stderr errors (1 pt)
  const stderrErrors = (output.match(/\[stderr\].*(?:error|exception|fail)/gi) || []).length
  if (stderrErrors === 0) {
    grade += 1
    lines.push('✅ No stderr errors (+1)')
  } else {
    lines.push(`⚠️ ${stderrErrors} stderr error line(s) detected (+0)`)
  }

  // Speed bonus — under 2 min (1 pt)
  if (elapsedSec <= 120) {
    grade += 1
    lines.push(`✅ Completed in ${elapsedSec}s < 2min (+1)`)
  } else {
    lines.push(`ℹ️ Completed in ${elapsedSec}s (+0)`)
  }

  // Substantial output (1 pt)
  if (output.length > 300) {
    grade += 1
    lines.push('✅ Substantial output produced (+1)')
  }

  return { grade: Math.min(10, grade), auditNotes: lines.join('\n') }
}

/** Extract a short lesson from run output. Zero AI tokens — regex + heuristics. */
function extractLesson(taskDesc: string, output: string, grade: number, files: string[], elapsedSec: number): string {
  // Look for a COMPLETED / SUMMARY / RESULT marker line
  const match = output.match(/(?:all tasks? (?:done|complete)|completed?|summary|result)[:\s]+([^\n]{20,200})/i)
  const highlight = match ? match[1].trim().slice(0, 140) : ''

  const topFiles = files.slice(0, 3).map(f => f.split(/[/\\]/).pop() || f).join(', ')
  const parts = [
    `"${taskDesc.slice(0, 70)}"`,
    `Grade ${grade}/10`,
    `${files.length} file(s)${topFiles ? ` (${topFiles})` : ''}`,
    `${elapsedSec}s`,
    highlight || (grade >= 7 ? 'Completed successfully.' : grade >= 4 ? 'Completed with warnings.' : 'Encountered errors.'),
  ]
  return parts.join(' · ')
}

/** Full post-run pipeline: Audit → Grade → Lesson → Task gate → Memory */
export function runPostRunPipeline(
  runId: number,
  folder: string,
  taskDesc: string,
  output: string,
  exitCode: number,
  files: string[],
  elapsedSec: number,
  beforeSnapshot?: WorkspaceSnapshot,
) {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)

    // 1. AUDIT + GRADE
    const { grade, auditNotes } = auditRun(output, exitCode, files, elapsedSec)

    // 2. LESSON
    const lesson = extractLesson(taskDesc, output, grade, files, elapsedSec)

    // 3. Persist to run row
    db.prepare(`UPDATE orchestrator_runs SET grade = ?, audit_notes = ?, lesson = ? WHERE id = ?`)
      .run(grade, auditNotes, lesson, runId)

    // 4. TASK GATE — advance linked task to quality_review (audit gate before done)
    const run = db.prepare(`SELECT task_id FROM orchestrator_runs WHERE id = ?`).get(runId) as any
    if (run?.task_id) {
      const gradeEmoji = grade >= 8 ? '🟢' : grade >= 5 ? '🟡' : '🔴'
      const currentTask = db.prepare(`SELECT status, assigned_to, created_at, updated_at, estimated_hours, actual_hours, metadata FROM tasks WHERE id = ?`).get(run.task_id) as any
      const currentMetadata = parseTaskMetadata(currentTask?.metadata)
      const workspaceRoot = resolveTaskWorkspaceRoot(run.task_id, folder)
      const verification = verifyTaskExecution({
        taskStatus: currentTask?.status || 'in_progress',
        output,
        beforeSnapshot: beforeSnapshot || {},
        afterSnapshot: captureWorkspaceSnapshot(workspaceRoot),
        generatedFiles: files,
        priorVerifiedChangedFiles: Array.isArray(currentMetadata?.verification?.changed_files)
          ? currentMetadata.verification.changed_files
          : [],
      })
      const nextStatus = exitCode === 0 && verification.passed ? 'quality_review' : 'inbox'
      const verificationMetadata = {
        ...currentMetadata,
        verification: {
          checked_at: now,
          passed: verification.passed,
          reason: verification.reason,
          changed_files: verification.changedFiles.slice(0, 25),
        },
      }
      const nextMetadata = mergeTaskProgressMetadata({
        status: currentTask?.status || nextStatus,
        created_at: currentTask?.created_at || now,
        updated_at: currentTask?.updated_at || now,
        estimated_hours: currentTask?.estimated_hours,
        actual_hours: currentTask?.actual_hours,
        metadata: currentMetadata,
      }, nextStatus, now, verificationMetadata)
      db.prepare(`UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
        .run(nextStatus, null, JSON.stringify(nextMetadata), now, run.task_id)
      db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, ?, ?, ?)`)
        .run(
          run.task_id,
          'orchestrator-audit',
          verification.passed
            ? `## 📋 Audit Report — Grade: ${grade}/10 ${gradeEmoji}\n\n${auditNotes}\n\n**Verification:** ${verification.reason}\n\n**Lesson:** ${lesson}`
            : `## 📋 Audit Report — Grade: ${grade}/10 ${gradeEmoji}\n\n${auditNotes}\n\n**Verification failed:** ${verification.reason}\n\nTask was re-queued for another implementation pass instead of being marked complete.\n\n**Lesson:** ${lesson}`,
          now,
        )
      db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES (?, 'task', ?, 'orchestrator', ?)`)
        .run(
          verification.passed ? 'task_verified' : 'task_requeued',
          run.task_id,
          verification.passed
            ? `Verified completion for task ${run.task_id}`
            : `Verification failed for task ${run.task_id}; re-queued for another agent pass`,
        )
    }

    // 5. MEMORY — log lesson as activity so it shows in the activity feed
    try {
      db.prepare(
        `INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES (?, 'orchestrator_run', ?, 'orchestrator', ?)`
      ).run('orchestrator_lesson', runId, lesson)
    } catch { /* activities may reject unknown entity types */ }

    // 5b. Learned memory — compact retrieval file for future runs
    try {
      writeProjectLearningMemory({
        folder: (db.prepare('SELECT folder FROM orchestrator_runs WHERE id = ?').get(runId) as { folder?: string } | undefined)?.folder || process.cwd(),
        source: 'orchestrator',
        scope: 'mission-control',
        task: taskDesc,
        summary: lesson,
        outcome: exitCode === 0 ? `Run completed with grade ${grade}/10` : `Run failed with grade ${grade}/10`,
        files,
      })
    } catch (err) {
      logger.warn({ err }, `orchestrator run ${runId}: learned memory write failed`)
    }

    // 6. TEAM STATUS — mark TechLead idle after run completes
    try {
      const gradeEmoji = grade >= 8 ? '🟢' : grade >= 5 ? '🟡' : '🔴'
      db.prepare(`UPDATE agents SET status = 'idle', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = 'TechLead'`)
        .run(`${gradeEmoji} Run #${runId} completed — Grade ${grade}/10`, now, now)

      // Optional behavior: keep orchestrator team idle after run instead of forcing offline.
      const keepIdleSetting = db.prepare(`SELECT value FROM settings WHERE key = 'general.orchestrator_set_idle_after_run'`).get() as { value?: string } | undefined
      const keepIdleAfterRun = keepIdleSetting ? keepIdleSetting.value === 'true' : true
      if (keepIdleAfterRun) {
        db.prepare(`
          UPDATE agents
          SET status = 'idle',
              last_seen = COALESCE(last_seen, ?),
              last_activity = COALESCE(last_activity, 'Awaiting next assignment'),
              updated_at = ?
          WHERE config LIKE '%"team":"orchestrator"%'
            AND name != 'TechLead'
        `).run(now, now)
      }
    } catch { /* agents table may not have team yet */ }

    logAuditEvent({
      action: 'orchestrator_run_pipeline',
      actor: 'orchestrator',
      detail: { run_id: runId, grade, files_count: files.length, elapsed_sec: elapsedSec },
    })
  } catch (err) {
    logger.error({ err }, `orchestrator run ${runId}: post-run pipeline failed`)
  }
}

// ─── FILE ININI RESOLVER ──────────────────────────────────────────────────────

/**
 * Validates that a file path is safe to read:
 * - Not in system/sensitive directories
 * - Not a sensitive file type
 * - Only allowed text extensions
 */
function isSafeFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()

  // Block system and sensitive directories
  const BLOCKED_PATTERNS = [
    '/etc/', '/root/', '/proc/', '/sys/', '/boot/', '/dev/', '/run/',
    'c:/windows/', 'c:/system32/', 'c:/program files', 'c:/programdata/',
    '/.ssh/', '/.aws/', '/.gnupg/', '/.config/',
    '/node_modules/', '/.git/',
  ]
  if (BLOCKED_PATTERNS.some(p => normalized.includes(p))) return false

  // Block sensitive file names and extensions
  const BLOCKED_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.asc']
  const BLOCKED_NAMES = ['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'shadow', 'passwd']
  const fileName = normalized.split('/').pop() || ''
  if (BLOCKED_EXTENSIONS.some(e => fileName.endsWith(e))) return false
  if (BLOCKED_NAMES.some(n => fileName === n || fileName.startsWith(n + '.'))) return false

  // Only allow safe text extensions
  const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.log', '.json', '.csv', '.yaml', '.yml'])
  const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : ''
  if (!ALLOWED_EXTENSIONS.has(ext)) return false

  return true
}

/**
 * Resolve `/inini "path"` in a task description.
 * Supported: /inini "D:\path\to\file.md"  or  /inini D:\path\to\file.md
 * with optional leading "groq" prefix.
 *
 * If a file path is found and passes safety checks, reads its content
 * and prepends it to the task.
 * Returns the enriched task string (unchanged if no file path found or file unreadable).
 */
function extractIniniPaths(task: string) {
  const matches = [...task.matchAll(/(?:groq\s+)?\/inini\s+"?([^"\n]+)"?/gi)]
  return matches.map((match) => match[1].trim().replace(/^"|"$/g, ''))
}

export function resolveIniniTask(task: string): string {
  const filePaths = extractIniniPaths(task)
  if (filePaths.length === 0) return task

  const injected: string[] = []
  for (const filePath of filePaths) {
    if (!isSafeFilePath(filePath)) continue
    try {
      if (!existsSync(filePath)) continue
      const content = readFileSync(filePath, 'utf-8').slice(0, 8000)
      if (!content.trim()) continue
      injected.push([
        `📄 FILE CONTEXT from: ${filePath}`,
        '─'.repeat(60),
        content,
      ].join('\n'))
    } catch {
      // skip unreadable files
    }
  }

  const baseTask = task.replace(/(?:groq\s+)?\/inini\s+"?([^"\n]+)"?\s*/gi, '').trim()
  if (injected.length === 0) return baseTask || task

  return [
    ...injected,
    '─'.repeat(60),
    baseTask || 'Analyze the referenced files above and suggest fixes or improvements.',
  ].join('\n')
}

// ─── AUTO REFERENCE FILE INJECTION ───────────────────────────────────────────

/**
 * Autonomously select and inject the top reference files from the project folder.
 * Reads up to 3 highest-priority files (todo, errorreport, readme, etc.) and
 * prepends their content to the task, giving the orchestrator full context.
 *
 * Only runs when the task doesn't already contain /inini directives.
 */
export function autoInjectReferenceFiles(task: string, folder: string): string {
  const contextSettings = getOrchestratorContextSettings()
  const manualPaths = new Set(extractIniniPaths(task).map((filePath) => normalize(filePath).toLowerCase()))

  const files = suggestProjectFiles(folder, task)
    .filter((file) => {
      if (file.source === 'reference-pack') return contextSettings.autoAttachReferencePack
      if (file.source === 'learned-memory') return contextSettings.autoAttachLearnedMemory
      return true
    })
  if (files.length === 0) return task

  const MAX_INJECT = 3
  const MAX_BYTES_PER_FILE = 3000
  const injected: string[] = []

  for (const file of files.slice(0, MAX_INJECT)) {
    if (manualPaths.has(normalize(file.path).toLowerCase())) continue
    if (!isSafeFilePath(file.path)) continue
    try {
      if (!existsSync(file.path)) continue
      const content = readFileSync(file.path, 'utf-8').slice(0, MAX_BYTES_PER_FILE)
      if (!content.trim()) continue
      injected.push(`${file.reason} — ${file.name}\n${'─'.repeat(50)}\n${content}`)
    } catch { /* unreadable */ }
  }

  if (injected.length === 0) return task

  return [
    `📚 AUTO-LOADED REFERENCE FILES (${injected.length} of ${files.length} found)`,
    '═'.repeat(60),
    injected.join('\n\n'),
    '═'.repeat(60),
    task,
  ].join('\n')
}

// ─── SPAWN ────────────────────────────────────────────────────────────────────

/** Spawn the orchestrator CLI process, stream output into DB, then run pipeline */
export function spawnOrchestrator(runId: number, folder: string, task: string) {
  // 1. Resolve /inini file references (manual injection)
  task = resolveIniniTask(task)

  // 2. Auto-inject reference files from project folder (autonomous context loading)
  task = autoInjectReferenceFiles(task, folder)

  // 3. Detect task type and select the best model
  const taskType = detectTaskType(task)
  const model = selectModel(taskType)

  // 4. Prepend model/type metadata header (visible in panel run info)
  task = `[🤖 Model: ${model} | 📋 Type: ${taskType}]\n\n${task}`

  // 5. Persist enriched task to DB
  try {
    const db = getDatabase()
    db.prepare('UPDATE orchestrator_runs SET task_description = ? WHERE id = ?').run(task, runId)
  } catch { /* ignore */ }

  // Mark TechLead as busy in agent list
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`UPDATE agents SET status = 'busy', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = 'TechLead'`)
      .run(`🚀 Run #${runId} [${taskType}/${model.split('-').slice(0, 2).join('-')}]`, now, now)
  } catch { /* ignore if agents not seeded yet */ }

  // Load .env from orchestrator folder if it exists
  const childEnv = { ...process.env }
  const envFile = join(folder, '.env')
  if (existsSync(envFile)) {
    try {
      Object.assign(childEnv, parseEnvFile(envFile))
    } catch {
      // Invalid .env parsing should not block orchestrator startup.
    }
  }
  childEnv.DOTENV_CONFIG_QUIET = childEnv.DOTENV_CONFIG_QUIET || 'true'

  // 6. Set GROQ_MODEL env var (don't override if already set in project .env)
  childEnv.GROQ_MODEL = childEnv.GROQ_MODEL || model
  childEnv.MC_TASK_TYPE = taskType

  const startedAt = Math.floor(Date.now() / 1000)
  const taskRow = (() => {
    try {
      const db = getDatabase()
      return db.prepare(`SELECT task_id FROM orchestrator_runs WHERE id = ?`).get(runId) as { task_id?: number | null } | undefined
    } catch {
      return undefined
    }
  })()
  const workspaceRoot = resolveTaskWorkspaceRoot(taskRow?.task_id, folder)
  const beforeSnapshot = captureWorkspaceSnapshot(workspaceRoot)

  const orchestratorEntry = join(folder, 'index.js')
  const child = spawn(process.execPath, [orchestratorEntry, task], {
    env: childEnv,
    shell: false,
  })

  try {
    const db = getDatabase()
    db.prepare('UPDATE orchestrator_runs SET output = output || ? WHERE id = ?')
      .run(`[system] Spawning orchestrator process for run #${runId} in ${folder}\n`, runId)
  } catch { /* ignore */ }

  // Track which sub-agents have been activated in this run
  const activeSubAgents = new Set<string>()
  const TEAM_AGENTS = ['ChatGPT', 'Gemini', 'Kimi', 'AmazonQ', 'Ollama', 'UIDesigner', 'Groq']

  const append = (chunk: string) => {
    try {
      const db = getDatabase()
      const clean = chunk.replace(/\x1B\[[0-9;]*m/g, '')
      db.prepare('UPDATE orchestrator_runs SET output = output || ? WHERE id = ?').run(clean, runId)

      // Detect sub-agent activation from output lines like "[ChatGPT] Executing task ..."
      for (const agent of TEAM_AGENTS) {
        if (!activeSubAgents.has(agent) && clean.includes(`[${agent}]`)) {
          activeSubAgents.add(agent)
          try {
            const now = Math.floor(Date.now() / 1000)
            db.prepare(`UPDATE agents SET status = 'busy', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = ?`)
              .run(`Working on Run #${runId}`, now, now, agent)
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      logger.warn({ err }, `orchestrator run ${runId}: db append failed`)
    }
  }

  child.stdout.on('data', (d) => append(d.toString()))
  child.stderr.on('data', (d) => append(`[stderr] ${d.toString()}`))

  child.on('close', (code) => {
    try {
      const db = getDatabase()
      const now = Math.floor(Date.now() / 1000)
      const elapsed = now - startedAt
      const status = code === 0 ? 'completed' : 'failed'

      // Collect generated files from output/ directory
      const outputDir = join(folder, 'output')
      const files: string[] = existsSync(outputDir) ? listFiles(outputDir) : []

      db.prepare('UPDATE orchestrator_runs SET status = ?, exit_code = ?, completed_at = ?, files_json = ? WHERE id = ?')
        .run(status, code ?? -1, now, JSON.stringify(files), runId)

      // Fetch full output for pipeline
      const row = db.prepare('SELECT output, task_description FROM orchestrator_runs WHERE id = ?').get(runId) as any
      runPostRunPipeline(runId, workspaceRoot, row?.task_description || task, row?.output || '', code ?? -1, files, elapsed, beforeSnapshot)
    } catch (err) {
      logger.error({ err }, `orchestrator run ${runId}: close handler failed`)
    }
  })

  child.on('error', (err) => {
    try {
      const db = getDatabase()
      db.prepare('UPDATE orchestrator_runs SET status = ?, error = ?, completed_at = ? WHERE id = ?')
        .run('failed', err.message, Math.floor(Date.now() / 1000), runId)
    } catch { /* ignore */ }
  })
}

/** Spawn a standalone agent to handle a specific task */
export function spawnAgentTask(agentName: string, taskId: number, task: string) {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const startTask = db.prepare(`SELECT status, metadata FROM tasks WHERE id = ?`).get(taskId) as { status?: string; metadata?: string | null } | undefined
  const startStatus = startTask?.status || 'in_progress'
  const workspaceRoot = resolveTaskWorkspaceRoot(taskId)
  const beforeSnapshot = captureWorkspaceSnapshot(workspaceRoot)

  // Mark agent as busy
  try {
    db.prepare(`UPDATE agents SET status = 'busy', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = ?`)
      .run(`Working on Task #${taskId}`, now, now, agentName)
  } catch { /* ignore */ }

  const childEnv = { ...process.env }
  childEnv.MC_TASK_ID = String(taskId)

  // Use the configured agent binary (defaulting to openclaw)
  const bin = config.openclawBin || 'openclaw'
  if (!commandExists(bin)) {
    try {
      const fallbackProject = db.prepare(
        `SELECT id, name, folder FROM orchestrator_projects ORDER BY updated_at DESC LIMIT 1`
      ).get() as { id: number; name: string; folder: string } | undefined

      const projectOk = !!fallbackProject?.folder && existsSync(join(fallbackProject.folder, 'index.js'))
      if (!projectOk) {
        throw new Error(`Agent runtime "${bin}" not found and no orchestrator project with index.js is available`)
      }

      markStaleOrchestratorRuns(fallbackProject.id, now)

      const runningFallbackRun = db.prepare(
        `SELECT id FROM orchestrator_runs WHERE project_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`
      ).get(fallbackProject.id) as { id: number } | undefined

      if (runningFallbackRun) {
        const queuedStatus = startStatus === 'review' || startStatus === 'quality_review' ? startStatus : 'assigned'
        const currentTask = db.prepare(`SELECT status, created_at, updated_at, estimated_hours, actual_hours, metadata FROM tasks WHERE id = ?`).get(taskId) as any
        const currentMetadata = parseTaskMetadata(currentTask?.metadata)
        const nextMetadata = mergeTaskProgressMetadata({
          status: currentTask?.status || queuedStatus,
          created_at: currentTask?.created_at || now,
          updated_at: currentTask?.updated_at || now,
          estimated_hours: currentTask?.estimated_hours,
          actual_hours: currentTask?.actual_hours,
          metadata: currentMetadata,
        }, queuedStatus, now, currentMetadata)
        db.prepare(`UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
          .run(queuedStatus, 'AI Orchestrator', JSON.stringify(nextMetadata), now, taskId)
        db.prepare(`UPDATE agents SET status = 'idle', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = ?`)
          .run(`Queued Task #${taskId} behind Run #${runningFallbackRun.id}`, now, now, agentName)
        db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator', ?, ?)`)
          .run(taskId, `Agent runtime "${bin}" is unavailable. Queued behind existing orchestrator run **#${runningFallbackRun.id}** instead of spawning another fallback run.`, now)
        db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES ('task_queued','task',?,'orchestrator',?)`)
          .run(taskId, `Queued for existing local orchestrator runtime (Run #${runningFallbackRun.id})`)
        return
      }

      const normalizedStatus = startStatus === 'inbox' || startStatus === 'assigned' ? 'in_progress' : startStatus
      const runTask = `Agent fallback run for Task #${taskId} (original assignee: ${agentName})\n\n${task}`
      const runRow = db.prepare(
        `INSERT INTO orchestrator_runs (project_id, folder, task_description, status, started_at, task_id)
         VALUES (?, ?, ?, 'running', ?, ?)`
      ).run(fallbackProject.id, fallbackProject.folder, runTask, now, taskId)
      const runId = runRow.lastInsertRowid as number

      const currentTask = db.prepare(`SELECT status, created_at, updated_at, estimated_hours, actual_hours, metadata FROM tasks WHERE id = ?`).get(taskId) as any
      const nextMetadata = mergeTaskProgressMetadata({
        status: currentTask?.status || normalizedStatus,
        created_at: currentTask?.created_at || now,
        updated_at: currentTask?.updated_at || now,
        estimated_hours: currentTask?.estimated_hours,
        actual_hours: currentTask?.actual_hours,
        metadata: currentTask?.metadata ? JSON.parse(currentTask.metadata) : {},
      }, normalizedStatus, now, currentTask?.metadata ? JSON.parse(currentTask.metadata) : {})
      db.prepare(`UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
        .run(normalizedStatus, 'TechLead', JSON.stringify(nextMetadata), now, taskId)
      db.prepare(`UPDATE agents SET status = 'idle', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = ?`)
        .run(`Fallback routed Task #${taskId} to TechLead`, now, now, agentName)
      db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator', ?, ?)`)
        .run(taskId, `Agent runtime "${bin}" is unavailable. Routed to orchestrator project **${fallbackProject.name}** (Run #${runId}).`, now)
      db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES ('task_assigned','task',?,'orchestrator',?)`)
        .run(taskId, `Fallback routed from ${agentName} to TechLead (Run #${runId})`)

      spawnOrchestrator(runId, fallbackProject.folder, runTask)
      return
    } catch (err: any) {
      const reason = err?.message || `Agent runtime "${bin}" is unavailable`
      try {
        db.prepare(`UPDATE agents SET status = 'idle', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = ?`)
          .run(`Failed Task #${taskId}: ${reason}`, now, now, agentName)
        db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator', ?, ?)`)
          .run(taskId, reason, now)
        db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES ('task_assignment_failed','task',?,'orchestrator',?)`)
          .run(taskId, `Assignment to ${agentName} failed: ${reason}`)
      } catch { /* ignore */ }
      return
    }
  }
  
  // Launch agent in headless mode with the task prompt
  // Command: openclaw agent <name> "<prompt>"
  const child = spawn(bin, ['agent', agentName, task], {
    cwd: config.openclawHome || process.cwd(),
    env: childEnv,
    shell: false,
  })

  const startedAt = now
  let finalized = false
  let combinedOutput = ''
  const finalizeFailure = (reason: string, detail?: string) => {
    if (finalized) return
    finalized = true
    try {
      const db = getDatabase()
      const finishTime = Math.floor(Date.now() / 1000)
      const nextStatus = (startStatus === 'review' || startStatus === 'quality_review') ? startStatus : 'in_progress'
      const currentTask = db.prepare(`SELECT status, created_at, updated_at, estimated_hours, actual_hours, metadata FROM tasks WHERE id = ?`).get(taskId) as any
      const currentMetadata = parseTaskMetadata(currentTask?.metadata)
      const autonomous = currentMetadata.autonomous && typeof currentMetadata.autonomous === 'object'
        ? currentMetadata.autonomous
        : {}
      const nextMetadata = mergeTaskProgressMetadata({
        status: currentTask?.status || nextStatus,
        created_at: currentTask?.created_at || finishTime,
        updated_at: currentTask?.updated_at || finishTime,
        estimated_hours: currentTask?.estimated_hours,
        actual_hours: currentTask?.actual_hours,
        metadata: currentMetadata,
      }, nextStatus, finishTime, {
        ...currentMetadata,
        autonomous: {
          ...autonomous,
          failure_count: Number(autonomous.failure_count || 0) + 1,
          debate_pending: true,
          report_to_orchestrator: true,
          recovery_plan: null,
          last_failed_agent: agentName,
          last_failure_stage: startStatus,
          last_failure_at: finishTime,
          last_failure_reason: reason,
          last_exit_code: null,
        },
      })
      db.prepare(`UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?`)
        .run(nextStatus, JSON.stringify(nextMetadata), finishTime, taskId)
      db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator', ?, ?)`)
        .run(taskId, `Agent **${agentName}** could not start: ${reason}${detail ? `\n\n\`\`\`\n${detail}\n\`\`\`` : ''}`, finishTime)
      db.prepare(`UPDATE agents SET status = 'idle', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = ?`)
        .run(`Failed Task #${taskId}: ${reason}`, finishTime, finishTime, agentName)
      db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES ('task_assignment_failed','task',?,'orchestrator',?)`)
        .run(taskId, `Assignment to ${agentName} failed: ${reason}`)
    } catch (err) {
      logger.error({ err }, `Agent ${agentName} task ${taskId}: failure finalization failed`)
    }

    try {
      writeAgentLearningMemory({
        agentName,
        task,
        summary: reason,
        outcome: detail ? `${reason} :: ${detail.slice(0, 160)}` : reason,
      })
    } catch (err) {
      logger.warn({ err }, `Agent ${agentName} task ${taskId}: failure memory write failed`)
    }
  }

  const append = (chunk: string) => {
    try {
      const clean = chunk.replace(/\x1B\[[0-9;]*m/g, '')
      combinedOutput = (combinedOutput + clean).slice(-4000)
      // We don't have an orchestrator_run row for individual agents yet, 
      // but we can log to task comments or a new table.
      // For now, let's just log to activity
    } catch { /* ignore */ }
  }

  child.stdout.on('data', (d) => append(d.toString()))
  child.stderr.on('data', (d) => append(`[stderr] ${d.toString()}`))

  child.on('close', (code) => {
    if (finalized) return
    finalized = true
    try {
      const db = getDatabase()
      const finishTime = Math.floor(Date.now() / 1000)
      const currentTask = db.prepare(`SELECT status, created_at, updated_at, estimated_hours, actual_hours, metadata FROM tasks WHERE id = ?`).get(taskId) as any
      const currentMetadata = parseTaskMetadata(currentTask?.metadata)
      const autonomous = currentMetadata.autonomous && typeof currentMetadata.autonomous === 'object'
        ? currentMetadata.autonomous
        : {}
      const verification = verifyTaskExecution({
        taskStatus: startStatus,
        output: combinedOutput,
        beforeSnapshot,
        afterSnapshot: captureWorkspaceSnapshot(workspaceRoot),
        priorVerifiedChangedFiles: Array.isArray(currentMetadata?.verification?.changed_files)
          ? currentMetadata.verification.changed_files
          : [],
      })
      let nextStatus = startStatus

      if (code === 0 && verification.passed) {
        if (startStatus === 'review') nextStatus = 'quality_review'
        else if (startStatus === 'quality_review') nextStatus = 'done'
        else nextStatus = 'review'
      } else {
        if (code === 0 && !verification.passed) {
          nextStatus = startStatus === 'review' || startStatus === 'quality_review' ? startStatus : 'inbox'
        } else if (startStatus === 'review' || startStatus === 'quality_review') {
          nextStatus = startStatus
        } else {
          nextStatus = 'in_progress'
        }
      }

      const nextMetadata = mergeTaskProgressMetadata({
        status: currentTask?.status || nextStatus,
        created_at: currentTask?.created_at || finishTime,
        updated_at: currentTask?.updated_at || finishTime,
        estimated_hours: currentTask?.estimated_hours,
        actual_hours: currentTask?.actual_hours,
        metadata: currentMetadata,
      }, nextStatus, finishTime, {
        ...currentMetadata,
        autonomous: {
          ...autonomous,
          failure_count: code === 0 && verification.passed ? 0 : Number(autonomous.failure_count || 0) + 1,
          debate_pending: !(code === 0 && verification.passed),
          report_to_orchestrator: !(code === 0 && verification.passed),
          recovery_plan: null,
          last_failed_agent: code === 0 && verification.passed ? null : agentName,
          last_failure_stage: code === 0 && verification.passed ? null : startStatus,
          last_completed_at: finishTime,
          last_exit_code: code,
          last_result_status: nextStatus,
          last_failure_reason: code === 0 && verification.passed
            ? null
            : code !== 0
            ? `Agent exited with code ${code}`
            : verification.reason,
          last_verified_at: code === 0 && verification.passed ? finishTime : autonomous.last_verified_at,
        },
        verification: {
          checked_at: finishTime,
          passed: verification.passed,
          reason: verification.reason,
          changed_files: verification.changedFiles.slice(0, 25),
        },
      })
      const nextAssignee = nextStatus === 'in_progress' ? agentName : null
      db.prepare(`UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
        .run(nextStatus, nextAssignee, JSON.stringify(nextMetadata), finishTime, taskId)

      if (code === 0 && verification.passed && startStatus === 'quality_review') {
        try {
          db.prepare(
            `INSERT INTO quality_reviews (task_id, reviewer, status, notes, created_at)
             VALUES (?, ?, 'approved', ?, ?)`
          ).run(taskId, agentName, `Approved by ${agentName} automated quality review`, finishTime)
        } catch {
          // Non-fatal if review insert fails
        }
      }

      // Mark agent as idle again
      db.prepare(`UPDATE agents SET status = 'idle', last_activity = ?, last_seen = ?, updated_at = ? WHERE name = ?`)
        .run(`Finished Task #${taskId} (${nextStatus})`, finishTime, finishTime, agentName)

      try {
        writeAgentLearningMemory({
          agentName,
          task,
          summary: combinedOutput.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 180) || `Finished Task #${taskId}`,
          outcome: code === 0
            ? verification.passed
              ? `Completed and moved task to ${nextStatus}`
              : `Verification failed; task re-queued to ${nextStatus}`
            : `Exited with code ${code}; task remains ${nextStatus}`,
        })
      } catch (err) {
        logger.warn({ err }, `Agent ${agentName} task ${taskId}: learned memory write failed`)
      }

      if (code !== 0 || !verification.passed) {
        const outputSnippet = combinedOutput.trim().slice(-1200)
        db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator', ?, ?)`)
          .run(
            taskId,
            code !== 0
              ? `Agent **${agentName}** exited with code ${code}. Task kept at **${nextStatus}**.${outputSnippet ? `\n\n\`\`\`\n${outputSnippet}\n\`\`\`` : ''}`
              : `Agent **${agentName}** exited successfully, but verification failed. ${verification.reason}\n\nTask was moved to **${nextStatus}** for another pass.${outputSnippet ? `\n\n\`\`\`\n${outputSnippet}\n\`\`\`` : ''}`,
            finishTime,
          )
      }

      db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES (?, 'task', ?, ?, ?)`)
        .run(
          verification.passed ? 'task_verified' : 'task_requeued',
          taskId,
          agentName,
          verification.passed
            ? `Verified completion for task ${taskId}`
            : `Verification failed for task ${taskId}; re-queued for another pass`,
        )

      logAuditEvent({ 
        action: 'agent_task_complete', 
        actor: agentName, 
        detail: {
          task_id: taskId,
          exit_code: code,
          duration: finishTime - startedAt,
          from_status: startStatus,
          to_status: nextStatus,
          verification_passed: verification.passed,
          changed_files: verification.changedFiles.slice(0, 10),
        } 
      })
    } catch (err) {
      logger.error({ err }, `Agent ${agentName} task ${taskId}: close handler failed`)
    }
  })

  child.on('error', (err) => {
    finalizeFailure(err.message)
  })
}

function commandExists(bin: string): boolean {
  try {
    if (!bin) return false
    if (bin.includes('\\') || bin.includes('/') || /^[a-zA-Z]:/.test(bin)) {
      return existsSync(bin)
    }
    const checker = process.platform === 'win32' ? 'where' : 'which'
    const result = spawnSync(checker, [bin], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    return false
  }
}

export function isAgentRuntimeAvailable(): { ok: boolean; bin: string; reason?: string } {
  const bin = config.openclawBin || 'openclaw'
  if (!commandExists(bin)) {
    return { ok: false, bin, reason: `Agent runtime not found: "${bin}"` }
  }
  return { ok: true, bin }
}
