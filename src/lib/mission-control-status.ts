import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { getLocalRuntimeStatus } from '@/lib/agent-runtime-status'
import { getOrchestratorControlState } from '@/lib/orchestrator-control'
import { getAllGatewaySessions } from '@/lib/sessions'
import type {
  MissionControlAgentRow,
  MissionControlBlockedWorkflow,
  MissionControlHeartbeatRow,
  MissionControlPipelineInspectorStage,
  MissionControlPipelineStage,
  MissionControlSnapshot,
  MissionControlStage,
  MissionControlSummary,
  MissionControlTaskRow,
  MissionControlToolTimelineEntry,
  MissionControlUsageMetric,
  MissionControlUsageSummary,
  UnifiedStatusEvent,
} from '@/types/mission-control'

type AgentRecord = {
  id: number
  name: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_seen: number | null
  last_activity: string | null
  updated_at: number
  config: string | null
}

type TaskRecord = {
  id: number
  title: string
  status: string
  priority: string
  assigned_to: string | null
  updated_at: number
  metadata: string | null
}

type ActivityRecord = {
  id: number
  type: string
  entity_type: string
  entity_id: number
  actor: string
  description: string
  data: string | null
  created_at: number
}

type OrchestratorRunRecord = {
  id: number
  task_id: number | null
  task_description: string
  status: string
  output: string
  error: string | null
  started_at: number
  completed_at: number | null
}

type PipelineRunRecord = {
  id: number
  status: string
  current_step: number
  steps_snapshot: string
  started_at: number | null
  completed_at: number | null
}

type ParsedLogEntry = {
  id: string
  tsMs: number
  source: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

type TokenUsageRecord = {
  model: string | null
  input_tokens: number
  output_tokens: number
  created_at: number
}

type ClaudeSessionRecord = {
  model: string | null
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  last_message_at: string | null
  is_active: number
}

type ActivityPayload = {
  agentName?: string
  task_id?: number
  taskTitle?: string
  task_title?: string
  toolName?: string
  tool_name?: string
  toolTarget?: string
  tool_target?: string
  toolResult?: string
  tool_result?: string
  toolArgs?: unknown
  toolArgsPreview?: string
  tool_args_preview?: string
  thinkingSummary?: string
  thinking_summary?: string
  latency?: number
  stage?: string
  severity?: 'info' | 'warn' | 'error'
  blocker?: string
  model?: string
  memoryUsage?: string
  memory_usage?: string
  cpuUsage?: string
  cpu_usage?: string
  tokenUsage?: number | { inputTokens?: number; outputTokens?: number }
  token_usage?: {
    model?: string
    inputTokens?: number
    outputTokens?: number
  }
}

type HeartbeatSignal = {
  tsMs: number
  memoryUsage?: string
  cpuUsage?: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVE_WINDOW_MS = 30 * 1000
const IDLE_WINDOW_MS = 5 * 60 * 1000
const STATUS_FALLBACK_WINDOW_MS = 30 * 60 * 1000
const EVENT_RATE_WINDOW_MS = 30 * 1000
const CALLS_PER_MINUTE_WINDOW_MS = 60 * 1000
const FEED_LIMIT = 160
const TOOL_TIMELINE_LIMIT = 80
const SNAPSHOT_TTL_MS = 5_000
const FAST_SNAPSHOT_TTL_MS = 1_500

const PIPELINE_LABELS: Array<{ key: Exclude<MissionControlStage, 'idle'>; label: string }> = [
  { key: 'scan', label: 'Scan' },
  { key: 'plan', label: 'Plan' },
  { key: 'patch', label: 'Patch' },
  { key: 'validate', label: 'Validate' },
  { key: 'report', label: 'Report' },
]

const KNOWN_TOOL_NAMES = [
  'read_repo',
  'write_file',
  'diff_check',
  'apply_patch',
  'read',
  'write',
  'exec',
  'run_tests',
  'analyze_diff',
  'bash',
  'browser',
  'web',
  'memory_search',
  'memory_get',
]

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
}

const DEFAULT_PRICING = { input: 3 / 1_000_000, output: 15 / 1_000_000 }

let missionControlSnapshotCache: MissionControlSnapshot | null = null
let missionControlSnapshotCacheTs = 0
let missionControlSnapshotRefreshing = false

type SnapshotBuildOptions = {
  includeSlowSources: boolean
}

export function classifyAgentPresence(lastEventMs?: number | null): MissionControlAgentRow['status'] {
  if (!lastEventMs) return 'offline'
  const age = Date.now() - lastEventMs
  if (age < ACTIVE_WINDOW_MS) return 'active'
  if (age < IDLE_WINDOW_MS) return 'idle'
  return 'offline'
}

export function extractToolName(text?: string | null) {
  if (!text) return undefined
  const explicitTool = text.match(/\btool(?: call)?[:\s]+([a-z0-9_.:-]+)/i)
  if (explicitTool?.[1]) return explicitTool[1]
  for (const toolName of KNOWN_TOOL_NAMES) {
    if (text.toLowerCase().includes(toolName.toLowerCase())) return toolName
  }
  return undefined
}

export function extractProgressPct(text?: string | null) {
  if (!text) return undefined
  const match = text.match(/\b(\d{1,3})%/)
  if (!match) return undefined
  const pct = Number(match[1])
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : undefined
}

export function inferStageFromText(text?: string | null): MissionControlStage {
  const value = (text || '').toLowerCase()
  if (!value) return 'idle'
  if (/\bscan|scanning|read repo|repo scan\b/.test(value)) return 'scan'
  if (/\bplan|planning|spec|todo|assigned|inbox\b/.test(value)) return 'plan'
  if (/\bvalidate|review|quality_review|qa|test|diff_check\b/.test(value)) return 'validate'
  if (/\bpatch|implement|coding|in_progress|write_file|apply_patch|fix\b/.test(value)) return 'patch'
  if (/\breport|done|complete|completed|summary\b/.test(value)) return 'report'
  return 'idle'
}

export function deriveThinkingSummary(
  explicitSummary?: string,
  stage?: MissionControlStage,
  taskTitle?: string,
  toolName?: string,
  summary?: string,
) {
  if (explicitSummary?.trim()) return explicitSummary.trim()

  const taskLabel = taskTitle?.trim()
  const toolLabel = toolName?.trim()
  if (stage === 'patch') {
    if (taskLabel && toolLabel) return `Updating ${taskLabel} with ${toolLabel}`
    if (taskLabel) return `Implementing ${taskLabel}`
    if (toolLabel) return `Applying changes with ${toolLabel}`
    return 'Implementing the current patch'
  }
  if (stage === 'validate') {
    if (taskLabel && toolLabel) return `Validating ${taskLabel} with ${toolLabel}`
    if (taskLabel) return `Reviewing ${taskLabel}`
    return 'Validating the current change set'
  }
  if (stage === 'plan') {
    if (taskLabel) return `Planning next steps for ${taskLabel}`
    return 'Planning the next workflow step'
  }
  if (stage === 'scan') {
    if (taskLabel) return `Scanning context for ${taskLabel}`
    return 'Scanning repository and context'
  }
  if (stage === 'report') {
    if (taskLabel) return `Reporting completion for ${taskLabel}`
    return 'Summarizing recent workflow results'
  }

  if (summary?.trim()) {
    const cleaned = summary.trim()
    return cleaned.length > 96 ? `${cleaned.slice(0, 93)}...` : cleaned
  }
  return 'Awaiting the next orchestration update'
}

function formatIso(tsMs: number | null | undefined) {
  return tsMs ? new Date(tsMs).toISOString() : undefined
}

function normalizeStage(value?: string | null): MissionControlStage | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'scan' || normalized === 'plan' || normalized === 'patch' || normalized === 'validate' || normalized === 'report' || normalized === 'idle') {
    return normalized
  }
  return inferStageFromText(value)
}

function parseJsonObject<T extends Record<string, unknown>>(value?: string | null): T | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as T : null
  } catch {
    return null
  }
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function truncate(value: string, max = 96) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function getTaskStage(status: string): MissionControlStage {
  switch (status) {
    case 'inbox':
    case 'assigned':
      return 'plan'
    case 'in_progress':
      return 'patch'
    case 'review':
    case 'quality_review':
      return 'validate'
    case 'done':
      return 'report'
    default:
      return 'idle'
  }
}

function extractLatency(value?: string | null) {
  if (!value) return undefined
  const match = value.match(/\b(?:latency|duration)[:=\s]+(\d{1,6})\s*ms\b/i) || value.match(/\b(\d{1,6})ms\b/i)
  const latency = match?.[1] ? Number(match[1]) : undefined
  return Number.isFinite(latency) ? latency : undefined
}

function extractModel(value?: string | null) {
  if (!value) return undefined
  const match = value.match(/\b(claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|llama-[a-z0-9.-]+|mistral-[a-z0-9.-]+)\b/i)
  return match?.[1]
}

function extractTokenUsage(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') return undefined
  const payload = value as { inputTokens?: unknown; outputTokens?: unknown }
  const inputTokens = toFiniteNumber(payload.inputTokens) || 0
  const outputTokens = toFiniteNumber(payload.outputTokens) || 0
  const total = inputTokens + outputTokens
  return total > 0 ? total : undefined
}

function extractToolArgsPreview(value: unknown) {
  const text = toText(value)
  if (text) return truncate(text, 120)
  if (!value || typeof value !== 'object') return undefined
  try {
    return truncate(JSON.stringify(value), 120)
  } catch {
    return undefined
  }
}

function getAgentConfigModel(configValue?: string | null) {
  const parsed = parseJsonObject<Record<string, unknown>>(configValue)
  return toText(parsed?.model) || toText(parsed?.defaultModel) || toText(parsed?.model_name)
}

function getConfiguredCoordinatorName() {
  const configured = String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || '').trim()
  if (!configured || configured.toLowerCase() === 'coordinator') return 'TechLead'
  return configured
}

function estimateCost(model: string | null | undefined, inputTokens: number, outputTokens: number) {
  const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING
  return Number(((inputTokens * pricing.input) + (outputTokens * pricing.output)).toFixed(4))
}

function readFileTail(filePath: string, maxBytes = 64 * 1024) {
  const stat = fs.statSync(filePath)
  const bytesToRead = Math.min(stat.size, maxBytes)
  const buffer = Buffer.alloc(bytesToRead)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead)
  } finally {
    fs.closeSync(fd)
  }
  return buffer.toString('utf8')
}

function parseLogLine(line: string, source: string): ParsedLogEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const timestamp = typeof parsed.timestamp === 'number'
        ? parsed.timestamp
        : new Date(parsed.timestamp || Date.now()).getTime()
      return {
        id: `${source}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        tsMs: Number.isFinite(timestamp) ? timestamp : Date.now(),
        source,
        level: parsed.level || 'info',
        message: parsed.message || trimmed,
      }
    } catch {
      // fall through
    }
  }

  const pipeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-Z]+)\|([^|]+)\|(.+)$/)
  if (pipeMatch) {
    const ts = new Date(pipeMatch[1]).getTime()
    const levelToken = pipeMatch[2].trim().toLowerCase()
    const level = levelToken.includes('error')
      ? 'error'
      : levelToken.includes('warn')
      ? 'warn'
      : levelToken.includes('debug')
      ? 'debug'
      : 'info'
    return {
      id: `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
      tsMs: Number.isFinite(ts) ? ts : Date.now(),
      source,
      level,
      message: pipeMatch[3].trim(),
    }
  }

  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/)
  const ts = isoMatch ? new Date(isoMatch[1]).getTime() : Date.now()
  const lower = trimmed.toLowerCase()
  const level = lower.includes('error')
    ? 'error'
    : lower.includes('warn')
    ? 'warn'
    : lower.includes('debug')
    ? 'debug'
    : 'info'

  return {
    id: `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    tsMs: Number.isFinite(ts) ? ts : Date.now(),
    source,
    level,
    message: trimmed,
  }
}

function readRecentLogEntries(limit = 120): ParsedLogEntry[] {
  const dirs = [config.logsDir, config.tempLogsDir].filter((dir): dir is string => Boolean(dir && fs.existsSync(dir)))
  const files = dirs
    .flatMap((dir) => fs.readdirSync(dir)
      .map((name) => path.join(dir, name))
      .filter((filePath) => {
        try {
          return fs.statSync(filePath).isFile()
        } catch {
          return false
        }
      }))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, 5)

  const entries: ParsedLogEntry[] = []
  for (const filePath of files) {
    let content = ''
    try {
      content = readFileTail(filePath)
    } catch {
      continue
    }
    const source = path.basename(filePath)
    const lines = content.split(/\r?\n/).slice(-200)
    for (const line of lines) {
      const parsed = parseLogLine(line, source)
      if (parsed) entries.push(parsed)
    }
  }

  return entries
    .sort((a, b) => b.tsMs - a.tsMs)
    .slice(0, limit)
}

function resolveEventPayload(activity: ActivityRecord) {
  return parseJsonObject<ActivityPayload>(activity.data)
}

function activityToEvent(
  activity: ActivityRecord,
  agentIdByName: Map<string, number>,
  agentNameById: Map<number, string>,
  taskById: Map<number, TaskRecord>,
): UnifiedStatusEvent {
  const data = resolveEventPayload(activity)
  const entityAgentName = activity.entity_type === 'agent' ? agentNameById.get(activity.entity_id) : undefined
  const agentName = entityAgentName || toText(data?.agentName) || activity.actor || 'System'
  const task = activity.entity_type === 'task'
    ? taskById.get(activity.entity_id)
    : typeof data?.task_id === 'number'
    ? taskById.get(data.task_id)
    : undefined

  const lowerType = activity.type.toLowerCase()
  const lowerDescription = activity.description.toLowerCase()
  const toolName = toText(data?.toolName) || toText(data?.tool_name) || extractToolName(`${activity.type} ${activity.description}`)
  const tokenUsage = extractTokenUsage(data?.tokenUsage) || extractTokenUsage(data?.token_usage)
  const model = toText(data?.model) || toText(data?.token_usage?.model) || extractModel(activity.description)
  const stage = normalizeStage(toText(data?.stage)) || inferStageFromText(`${activity.type} ${activity.description} ${task?.status || ''}`)

  let kind: UnifiedStatusEvent['kind'] = 'task_update'
  if (lowerType.includes('heartbeat')) {
    kind = 'heartbeat'
  } else if (toolName || lowerType.includes('tool')) {
    kind = 'tool_call'
  } else if (lowerType.includes('agent') && (lowerType.includes('status') || lowerDescription.includes('status'))) {
    kind = 'status'
  } else if (lowerType.includes('pipeline')) {
    kind = 'stage_change'
  } else if (lowerType.includes('review') || lowerDescription.includes('review')) {
    kind = 'review'
  } else if (lowerDescription.includes('error') || lowerType.includes('error')) {
    kind = 'error'
  } else if (lowerDescription.includes('wake') || lowerDescription.includes('started')) {
    kind = 'agent_start'
  }

  const severity = toText(data?.severity) === 'error'
    ? 'error'
    : toText(data?.severity) === 'warn'
    ? 'warn'
    : kind === 'error'
    ? 'error'
    : lowerDescription.includes('warn')
    ? 'warn'
    : 'info'

  return {
    id: `activity-${activity.id}`,
    ts: new Date(activity.created_at * 1000).toISOString(),
    agentId: String(agentIdByName.get(agentName) || 0),
    agentName,
    source: activity.entity_type === 'task' ? 'task' : 'local',
    kind,
    stage: stage === 'idle' ? undefined : stage,
    taskId: task ? String(task.id) : typeof data?.task_id === 'number' ? String(data.task_id) : undefined,
    taskTitle: task?.title || toText(data?.taskTitle) || toText(data?.task_title),
    summary: activity.description,
    toolName,
    toolTarget: toText(data?.toolTarget) || toText(data?.tool_target),
    toolResult: toText(data?.toolResult) || toText(data?.tool_result),
    toolArgsPreview: toText(data?.toolArgsPreview) || toText(data?.tool_args_preview) || extractToolArgsPreview(data?.toolArgs),
    progressPct: extractProgressPct(activity.description),
    thinkingSummary: deriveThinkingSummary(
      toText(data?.thinkingSummary) || toText(data?.thinking_summary),
      stage,
      task?.title || toText(data?.taskTitle) || toText(data?.task_title),
      toolName,
      activity.description,
    ),
    latency: toFiniteNumber(data?.latency) || extractLatency(activity.description),
    model,
    tokenUsage,
    severity,
    blocker: toText(data?.blocker) || (severity === 'error' ? activity.description : undefined),
  }
}

function sessionToEvent(session: ReturnType<typeof getAllGatewaySessions>[number], agentIdByName: Map<string, number>): UnifiedStatusEvent {
  return {
    id: `session-${session.agent}-${session.sessionId || session.key}`,
    ts: new Date(session.updatedAt).toISOString(),
    agentId: String(agentIdByName.get(session.agent) || 0),
    agentName: session.agent,
    source: 'session',
    kind: 'heartbeat',
    stage: 'idle',
    summary: `${session.agent} heartbeat via ${session.channel || 'gateway'}`,
    thinkingSummary: 'Maintaining orchestrator connectivity',
    severity: 'info',
  }
}

function runToEvent(run: OrchestratorRunRecord, taskById: Map<number, TaskRecord>, agentIdByName: Map<string, number>): UnifiedStatusEvent {
  const task = run.task_id ? taskById.get(run.task_id) : undefined
  const body = run.error || run.output || run.task_description
  const stage = inferStageFromText(body)
  const toolName = extractToolName(body)
  return {
    id: `run-${run.id}`,
    ts: new Date((run.completed_at || run.started_at) * 1000).toISOString(),
    agentId: String(agentIdByName.get('TechLead') || 0),
    agentName: 'TechLead',
    source: 'local',
    kind: run.status === 'running' ? 'stage_change' : run.error ? 'error' : 'task_update',
    stage: stage === 'idle' ? undefined : stage,
    taskId: task ? String(task.id) : run.task_id ? String(run.task_id) : undefined,
    taskTitle: task?.title,
    summary: compactTaskSummary(run.task_description),
    toolName,
    progressPct: extractProgressPct(body),
    thinkingSummary: deriveThinkingSummary(undefined, stage, task?.title, toolName, compactTaskSummary(run.task_description)),
    latency: extractLatency(body),
    model: extractModel(body),
    severity: run.error ? 'error' : run.status === 'running' ? 'info' : 'warn',
    blocker: run.error || undefined,
  }
}

function logToEvent(entry: ParsedLogEntry, agentIdByName: Map<string, number>): UnifiedStatusEvent {
  const agentNameMatch = entry.message.match(/\b(TechLead|ChatGPT|Gemini|Kimi|AmazonQ|Ollama|UIDesigner|Groq|Reviewer|Review2|Review3|Review4|Dev)\b/)
  const agentName = agentNameMatch?.[1] || 'System'
  const stage = inferStageFromText(entry.message)
  const toolName = extractToolName(entry.message)
  return {
    id: entry.id,
    ts: new Date(entry.tsMs).toISOString(),
    agentId: String(agentIdByName.get(agentName) || 0),
    agentName,
    source: 'log',
    kind: entry.level === 'error'
      ? 'error'
      : toolName
      ? 'tool_call'
      : entry.message.toLowerCase().includes('heartbeat')
      ? 'heartbeat'
      : 'status',
    stage: stage === 'idle' ? undefined : stage,
    summary: entry.message,
    toolName,
    thinkingSummary: deriveThinkingSummary(undefined, stage, undefined, toolName, entry.message),
    latency: extractLatency(entry.message),
    model: extractModel(entry.message),
    progressPct: extractProgressPct(entry.message),
    severity: entry.level === 'debug' ? 'info' : entry.level,
    blocker: entry.level === 'error' ? entry.message : undefined,
  }
}

function compactTaskSummary(taskDescription: string) {
  const stripped = taskDescription
    .replace(/^\[🤖[^\]]+\]\s*/m, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !line.startsWith('📚') && !line.startsWith('═') && !line.startsWith('─'))

  return stripped || 'Orchestrator task update'
}

function dedupeEvents(events: UnifiedStatusEvent[]) {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.id}:${event.ts}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pickCurrentTaskByAssignee(tasks: TaskRecord[]) {
  const rank: Record<string, number> = {
    in_progress: 0,
    review: 1,
    quality_review: 2,
    assigned: 3,
    inbox: 4,
    done: 5,
  }
  const currentTaskByAssignee = new Map<string, TaskRecord>()
  for (const task of tasks) {
    if (!task.assigned_to) continue
    const existing = currentTaskByAssignee.get(task.assigned_to)
    if (!existing) {
      currentTaskByAssignee.set(task.assigned_to, task)
      continue
    }
    const existingRank = rank[existing.status] ?? 99
    const nextRank = rank[task.status] ?? 99
    if (nextRank < existingRank || (nextRank === existingRank && task.updated_at > existing.updated_at)) {
      currentTaskByAssignee.set(task.assigned_to, task)
    }
  }
  return currentTaskByAssignee
}

function buildHeartbeatSignals(
  activities: ActivityRecord[],
  agentNameById: Map<number, string>,
): Map<string, HeartbeatSignal> {
  const signals = new Map<string, HeartbeatSignal>()
  for (const activity of activities) {
    if (!activity.type.toLowerCase().includes('heartbeat')) continue
    const data = resolveEventPayload(activity)
    const agentName = (activity.entity_type === 'agent' ? agentNameById.get(activity.entity_id) : undefined) || activity.actor
    if (!agentName || signals.has(agentName)) continue
    signals.set(agentName, {
      tsMs: activity.created_at * 1000,
      memoryUsage: toText(data?.memoryUsage) || toText(data?.memory_usage),
      cpuUsage: toText(data?.cpuUsage) || toText(data?.cpu_usage),
    })
  }
  return signals
}

function buildUsageSummary(tokenUsageRows: TokenUsageRecord[], claudeSessions: ClaudeSessionRecord[], events: UnifiedStatusEvent[]): MissionControlUsageSummary {
  const modelMap = new Map<string, MissionControlUsageMetric>()

  if (tokenUsageRows.length > 0) {
    for (const row of tokenUsageRows) {
      const model = row.model || 'unknown'
      const existing = modelMap.get(model) || {
        model,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        callsPerMinute: 0,
      }
      existing.inputTokens += row.input_tokens || 0
      existing.outputTokens += row.output_tokens || 0
      existing.estimatedCost = Number((existing.estimatedCost + estimateCost(model, row.input_tokens || 0, row.output_tokens || 0)).toFixed(4))
      if ((row.created_at * 1000) >= Date.now() - CALLS_PER_MINUTE_WINDOW_MS) {
        existing.callsPerMinute += 1
      }
      modelMap.set(model, existing)
    }
  } else {
    for (const session of claudeSessions) {
      const model = session.model || 'unknown'
      const existing = modelMap.get(model) || {
        model,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        callsPerMinute: 0,
      }
      existing.inputTokens += session.input_tokens || 0
      existing.outputTokens += session.output_tokens || 0
      existing.estimatedCost = Number((existing.estimatedCost + (session.estimated_cost || 0)).toFixed(4))
      const lastMessageMs = session.last_message_at ? new Date(session.last_message_at).getTime() : 0
      if (lastMessageMs >= Date.now() - CALLS_PER_MINUTE_WINDOW_MS) {
        existing.callsPerMinute += 1
      }
      modelMap.set(model, existing)
    }
  }

  const models = Array.from(modelMap.values())
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))

  const callsPerMinute = models.reduce((sum, model) => sum + model.callsPerMinute, 0)
    || events.filter((event) => event.kind === 'tool_call' && (Date.now() - new Date(event.ts).getTime()) <= CALLS_PER_MINUTE_WINDOW_MS).length

  return {
    totalInputTokens: models.reduce((sum, model) => sum + model.inputTokens, 0),
    totalOutputTokens: models.reduce((sum, model) => sum + model.outputTokens, 0),
    totalEstimatedCost: Number(models.reduce((sum, model) => sum + model.estimatedCost, 0).toFixed(4)),
    callsPerMinute,
    models,
  }
}

function buildBlockedWorkflows(agents: MissionControlAgentRow[], tasks: MissionControlTaskRow[]): MissionControlBlockedWorkflow[] {
  const blocked: MissionControlBlockedWorkflow[] = []

  for (const agent of agents) {
    if (!agent.blocker && agent.severity !== 'error') continue
    blocked.push({
      id: `agent-${agent.agentId}`,
      agentName: agent.agentName,
      reason: agent.blocker || 'Agent reported an error state',
      taskTitle: agent.task,
      stage: agent.stage,
    })
  }

  for (const task of tasks) {
    if (!task.blocker) continue
    blocked.push({
      id: `task-${task.id}`,
      agentName: task.assignedTo || 'Unassigned',
      reason: task.blocker,
      taskTitle: task.title,
      stage: task.stage,
    })
  }

  return blocked.slice(0, 20)
}

export function buildPipelineInspector(
  pipeline: MissionControlPipelineStage[],
  events: UnifiedStatusEvent[],
  runningRun: OrchestratorRunRecord | null,
): MissionControlPipelineInspectorStage[] {
  const now = Date.now()
  return pipeline.map((stage) => {
    const stageEvents = events
      .filter((event) => event.stage === stage.key)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

    const startMs = stageEvents[0]
      ? new Date(stageEvents[0].ts).getTime()
      : runningRun && inferStageFromText(`${runningRun.task_description}\n${runningRun.output}\n${runningRun.error || ''}`) === stage.key
      ? runningRun.started_at * 1000
      : undefined
    const endMs = stage.status === 'running'
      ? now
      : stageEvents.length > 0
      ? new Date(stageEvents[stageEvents.length - 1].ts).getTime()
      : runningRun?.completed_at && stage.status === 'completed'
      ? runningRun.completed_at * 1000
      : undefined

    return {
      key: stage.key,
      label: stage.label,
      status: stage.status,
      startTime: formatIso(startMs),
      durationMs: startMs && endMs && endMs >= startMs ? endMs - startMs : undefined,
      agentsInvolved: Array.from(new Set(stageEvents.map((event) => event.agentName).filter(Boolean))),
      logs: stageEvents.slice(-4).map((event) => `${event.agentName}: ${truncate(event.summary, 120)}`),
    }
  })
}

export function buildPipelineStages(
  runningRun: OrchestratorRunRecord | null,
  latestEvent: UnifiedStatusEvent | undefined,
  latestPipelineRun: PipelineRunRecord | null,
): MissionControlPipelineStage[] {
  let currentStage: MissionControlStage = 'idle'
  let errorStage: MissionControlStage | null = null

  if (runningRun) {
    currentStage = inferStageFromText(`${runningRun.task_description}\n${runningRun.output}\n${runningRun.error || ''}`)
    if (runningRun.error) errorStage = currentStage
  } else if (latestEvent?.stage) {
    currentStage = latestEvent.stage
    if (latestEvent.kind === 'error') errorStage = latestEvent.stage
  } else if (latestPipelineRun) {
    try {
      const steps = JSON.parse(latestPipelineRun.steps_snapshot) as Array<{ status?: string; template_name?: string }>
      const runningIndex = steps.findIndex((step) => step.status === 'running')
      const failedIndex = steps.findIndex((step) => step.status === 'failed')
      if (runningIndex >= 0) currentStage = PIPELINE_LABELS[Math.min(runningIndex, PIPELINE_LABELS.length - 1)].key
      if (failedIndex >= 0) errorStage = PIPELINE_LABELS[Math.min(failedIndex, PIPELINE_LABELS.length - 1)].key
    } catch {
      // ignore snapshot parse errors
    }
  }

  const currentIndex = PIPELINE_LABELS.findIndex((stage) => stage.key === currentStage)
  return PIPELINE_LABELS.map((stage, index) => {
    let status: MissionControlPipelineStage['status'] = 'pending'
    if (errorStage === stage.key) {
      status = 'error'
    } else if (currentStage !== 'idle' && index < currentIndex) {
      status = 'completed'
    } else if (currentStage !== 'idle' && index === currentIndex) {
      status = runningRun || latestEvent?.kind === 'stage_change' ? 'running' : 'completed'
    }
    return { ...stage, status }
  })
}

export function buildMissionControlSummary(
  agents: AgentRecord[],
  agentRows: MissionControlAgentRow[],
  tasks: TaskRecord[],
  events: UnifiedStatusEvent[],
  logEntries: ParsedLogEntry[],
): MissionControlSummary {
  const now = Date.now()
  const recentEvents = events.filter((event) => now - new Date(event.ts).getTime() <= EVENT_RATE_WINDOW_MS)
  const errors24h = logEntries.filter((entry) => entry.level === 'error' && now - entry.tsMs <= DAY_MS).length
    + events.filter((event) => event.severity === 'error' && now - new Date(event.ts).getTime() <= DAY_MS).length

  return {
    agentsRegistered: agents.length,
    agentsReachable: agentRows.filter((agent) => agent.reachable).length,
    agentsActive: agentRows.filter((agent) => agent.status === 'active').length,
    tasksRunning: tasks.filter((task) => task.status === 'in_progress').length,
    errors24h,
    eventRate: Math.round(recentEvents.length / (EVENT_RATE_WINDOW_MS / 1000)),
  }
}

function buildMissionControlSnapshot(options: SnapshotBuildOptions): MissionControlSnapshot {
  const db = getDatabase()
  const agents = db.prepare(`
    SELECT id, name, status, last_seen, last_activity, updated_at, config
    FROM agents
    ORDER BY updated_at DESC, name ASC
  `).all() as AgentRecord[]
  const tasks = db.prepare(`
    SELECT id, title, status, priority, assigned_to, updated_at, metadata
    FROM tasks
    ORDER BY updated_at DESC
    LIMIT 100
  `).all() as TaskRecord[]
  const activities = db.prepare(`
    SELECT id, type, entity_type, entity_id, actor, description, data, created_at
    FROM activities
    ORDER BY created_at DESC
    LIMIT 220
  `).all() as ActivityRecord[]
  const orchestratorRuns = db.prepare(`
    SELECT id, task_id, task_description, status, output, error, started_at, completed_at
    FROM orchestrator_runs
    ORDER BY started_at DESC
    LIMIT 25
  `).all() as OrchestratorRunRecord[]
  const pipelineRuns = db.prepare(`
    SELECT id, status, current_step, steps_snapshot, started_at, completed_at
    FROM pipeline_runs
    ORDER BY COALESCE(started_at, created_at) DESC
    LIMIT 10
  `).all() as PipelineRunRecord[]

  let tokenUsageRows: TokenUsageRecord[] = []
  if (options.includeSlowSources) {
    try {
      tokenUsageRows = db.prepare(`
        SELECT model, input_tokens, output_tokens, created_at
        FROM token_usage
        ORDER BY created_at DESC
        LIMIT 500
      `).all() as TokenUsageRecord[]
    } catch {
      tokenUsageRows = []
    }
  }

  let claudeSessions: ClaudeSessionRecord[] = []
  if (options.includeSlowSources) {
    try {
      claudeSessions = db.prepare(`
        SELECT model, input_tokens, output_tokens, estimated_cost, last_message_at, is_active
        FROM claude_sessions
        ORDER BY COALESCE(last_message_at, scanned_at) DESC
        LIMIT 200
      `).all() as ClaudeSessionRecord[]
    } catch {
      claudeSessions = []
    }
  }

  const sessions = options.includeSlowSources ? getAllGatewaySessions() : []
  const logEntries = options.includeSlowSources ? readRecentLogEntries() : []
  const localRuntime = getLocalRuntimeStatus()
  const configuredCoordinator = getConfiguredCoordinatorName().toLowerCase()
  const agentIdByName = new Map(agents.map((agent) => [agent.name, agent.id]))
  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]))
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const currentTaskByAssignee = pickCurrentTaskByAssignee(tasks)

  const unifiedEvents = dedupeEvents([
    ...activities.map((activity) => activityToEvent(activity, agentIdByName, agentNameById, taskById)),
    ...sessions.map((session) => sessionToEvent(session, agentIdByName)),
    ...orchestratorRuns.filter((run) => run.status === 'running' || run.completed_at || run.error).map((run) => runToEvent(run, taskById, agentIdByName)),
    ...logEntries.map((entry) => logToEvent(entry, agentIdByName)),
  ])
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, FEED_LIMIT)

  const latestEventByAgent = new Map<string, UnifiedStatusEvent>()
  const latestHeartbeatByAgent = new Map<string, UnifiedStatusEvent>()
  for (const event of unifiedEvents) {
    if (event.agentName && !latestEventByAgent.has(event.agentName)) {
      latestEventByAgent.set(event.agentName, event)
    }
    if (event.agentName && event.kind === 'heartbeat' && !latestHeartbeatByAgent.has(event.agentName)) {
      latestHeartbeatByAgent.set(event.agentName, event)
    }
  }

  const latestSessionByAgent = new Map<string, ReturnType<typeof getAllGatewaySessions>[number]>()
  for (const session of sessions) {
    if (!latestSessionByAgent.has(session.agent)) {
      latestSessionByAgent.set(session.agent, session)
    }
  }

  const heartbeatSignals = buildHeartbeatSignals(activities, agentNameById)

  const agentRows: MissionControlAgentRow[] = agents.map((agent) => {
    const latestEvent = latestEventByAgent.get(agent.name)
    const latestSession = latestSessionByAgent.get(agent.name)
    const task = currentTaskByAssignee.get(agent.name)
    const updatedSignalMs = Math.max(agent.last_seen ? agent.last_seen * 1000 : 0, agent.updated_at * 1000)
    const lastSignalMs = latestEvent
      ? new Date(latestEvent.ts).getTime()
      : latestSession?.updatedAt || heartbeatSignals.get(agent.name)?.tsMs || updatedSignalMs
    const inferredStage = latestEvent?.stage || getTaskStage(task?.status || '') || inferStageFromText(agent.last_activity)
    const hasRecentStoredPresence =
      updatedSignalMs > 0 && (Date.now() - updatedSignalMs) < STATUS_FALLBACK_WINDOW_MS
    const isConfiguredCoordinator = agent.name.toLowerCase() === configuredCoordinator
    const runtimeBackedCoordinator = isConfiguredCoordinator && localRuntime.available
    let status = classifyAgentPresence(lastSignalMs)
    if (
      status === 'offline' &&
      (runtimeBackedCoordinator || ((agent.status === 'idle' || agent.status === 'busy') && hasRecentStoredPresence))
    ) {
      status = 'idle'
    }

    return {
      agentId: String(agent.id),
      agentName: agent.name,
      stage: inferredStage === 'idle' ? inferStageFromText(agent.last_activity) : inferredStage,
      task: latestEvent?.taskTitle || task?.title || agent.last_activity || undefined,
      tool: latestEvent?.toolName || extractToolName(agent.last_activity),
      progressPct: latestEvent?.progressPct || extractProgressPct(agent.last_activity),
      lastEventTs: formatIso(lastSignalMs),
      status,
      thinkingSummary: latestEvent?.thinkingSummary || deriveThinkingSummary(undefined, inferredStage, task?.title, latestEvent?.toolName, latestEvent?.summary || agent.last_activity || undefined),
      model: latestEvent?.model || getAgentConfigModel(agent.config),
      tokenUsage: latestEvent?.tokenUsage,
      latency: latestEvent?.latency,
      blocker: latestEvent?.blocker,
      severity: latestEvent?.severity || (agent.status === 'error' ? 'error' : 'info'),
      summary: latestEvent?.summary || agent.last_activity || undefined,
      reachable: Boolean(
        (latestSession && (Date.now() - latestSession.updatedAt) < IDLE_WINDOW_MS)
        || (heartbeatSignals.get(agent.name) && (Date.now() - heartbeatSignals.get(agent.name)!.tsMs) < IDLE_WINDOW_MS)
        || runtimeBackedCoordinator
        || ((agent.status === 'idle' || agent.status === 'busy') && hasRecentStoredPresence)
      ),
    }
  })

  const taskRows: MissionControlTaskRow[] = tasks
    .slice(0, 100)
    .map((task) => {
      const metadata = parseJsonObject<Record<string, unknown>>(task.metadata) || {}
      const autonomous = metadata.autonomous && typeof metadata.autonomous === 'object'
        ? metadata.autonomous as Record<string, unknown>
        : {}
      const verification = metadata.verification && typeof metadata.verification === 'object'
        ? metadata.verification as Record<string, unknown>
        : {}
      const recoveryPlan = autonomous.recovery_plan && typeof autonomous.recovery_plan === 'object'
        ? autonomous.recovery_plan as Record<string, unknown>
        : {}
      const thirtyMinuteReview = metadata.orchestrator_review_30m && typeof metadata.orchestrator_review_30m === 'object'
        ? metadata.orchestrator_review_30m as Record<string, unknown>
        : {}
      const orchestratorReport = toText(thirtyMinuteReview.summary)
      const orchestratorReportType = (() => {
        const kind = toText(thirtyMinuteReview.kind)
        return kind === 'problem' || kind === 'wait' || kind === 'bug_restart'
          ? kind
          : undefined
      })()
      const orchestratorDecision = toText(recoveryPlan.summary)

      return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        assignedTo: task.assigned_to,
        stage: getTaskStage(task.status),
        updatedAt: new Date(task.updated_at * 1000).toISOString(),
        blocker: orchestratorReport
          || toText(autonomous.last_failure_reason)
          || toText(autonomous.last_debate_summary)
          || (task.status === 'quality_review'
            ? 'Awaiting review'
            : task.status === 'review'
            ? 'Validation in progress'
            : toText(verification.reason)),
        debatePending: autonomous.debate_pending === true,
        debateReason: toText(autonomous.last_debate_summary) || toText(autonomous.last_failure_reason) || toText(verification.reason),
        debateRounds: toFiniteNumber(autonomous.debate_rounds),
        lastSelfHealAt: toFiniteNumber(autonomous.last_self_heal_at)
          ? new Date(Number(autonomous.last_self_heal_at) * 1000).toISOString()
          : undefined,
        selfHealActions: toFiniteNumber(autonomous.self_heal_actions),
        orchestratorDecision,
        orchestratorReportType,
        orchestratorReport,
      }
    })

  const runningRun = orchestratorRuns.find((run) => run.status === 'running') || null
  const latestPipelineRun = pipelineRuns[0] || null
  const pipeline = buildPipelineStages(runningRun, unifiedEvents[0], latestPipelineRun)
  const heartbeat: MissionControlHeartbeatRow[] = agents.map((agent) => {
    const latestHeartbeat = latestHeartbeatByAgent.get(agent.name)
    const signal = heartbeatSignals.get(agent.name)
    const latestSession = latestSessionByAgent.get(agent.name)
    const updatedSignalMs = Math.max(agent.last_seen ? agent.last_seen * 1000 : 0, agent.updated_at * 1000)
    const heartbeatTs = latestHeartbeat
      ? new Date(latestHeartbeat.ts).getTime()
      : signal?.tsMs || latestSession?.updatedAt || (agent.last_seen ? agent.last_seen * 1000 : undefined)
    const hasRecentStoredPresence =
      updatedSignalMs > 0 && (Date.now() - updatedSignalMs) < STATUS_FALLBACK_WINDOW_MS
    const runtimeBackedCoordinator =
      agent.name.toLowerCase() === configuredCoordinator && localRuntime.available
    let heartbeatStatus = classifyAgentPresence(heartbeatTs)
    if (
      heartbeatStatus === 'offline' &&
      (runtimeBackedCoordinator || ((agent.status === 'idle' || agent.status === 'busy') && hasRecentStoredPresence))
    ) {
      heartbeatStatus = 'idle'
    }
    return {
      agentId: String(agent.id),
      agentName: agent.name,
      status: heartbeatStatus,
      lastHeartbeatTs: formatIso(heartbeatTs),
      memoryUsage: signal?.memoryUsage,
      cpuUsage: signal?.cpuUsage,
    }
  }).sort((a, b) => new Date(b.lastHeartbeatTs || 0).getTime() - new Date(a.lastHeartbeatTs || 0).getTime())
  const toolTimeline: MissionControlToolTimelineEntry[] = unifiedEvents
    .filter((event) => Boolean(event.toolName))
    .slice(0, TOOL_TIMELINE_LIMIT)
    .map((event) => ({
      id: event.id,
      ts: event.ts,
      agentName: event.agentName,
      toolName: event.toolName || 'unknown',
      target: event.toolTarget || event.toolArgsPreview,
      result: event.toolResult || event.severity,
      latency: event.latency,
    }))
  const usage = buildUsageSummary(tokenUsageRows, claudeSessions, unifiedEvents)
  const summary = buildMissionControlSummary(agents, agentRows, tasks, unifiedEvents, logEntries)
  const blocked = buildBlockedWorkflows(agentRows, taskRows)
  const pipelineInspector = buildPipelineInspector(pipeline, unifiedEvents, runningRun)

  return {
    generatedAt: new Date().toISOString(),
    summary,
    agents: agentRows,
    tasks: taskRows,
    events: unifiedEvents,
    pipeline,
    heartbeat,
    toolTimeline,
    usage,
    blocked,
    pipelineInspector,
    orchestrator: getOrchestratorControlState(),
  }
}

function refreshMissionControlSnapshot(options: SnapshotBuildOptions) {
  missionControlSnapshotCache = buildMissionControlSnapshot(options)
  missionControlSnapshotCacheTs = Date.now()
  return missionControlSnapshotCache
}

function scheduleMissionControlSnapshotRefresh() {
  if (missionControlSnapshotRefreshing) return
  missionControlSnapshotRefreshing = true
  setTimeout(() => {
    try {
      refreshMissionControlSnapshot({ includeSlowSources: true })
    } catch {
      // Keep the previous cache on best-effort refresh failures.
    } finally {
      missionControlSnapshotRefreshing = false
    }
  }, 0)
}

export function getMissionControlSnapshot(): MissionControlSnapshot {
  const now = Date.now()

  if (missionControlSnapshotCache) {
    const age = now - missionControlSnapshotCacheTs
    if (age <= SNAPSHOT_TTL_MS) {
      return missionControlSnapshotCache
    }
    scheduleMissionControlSnapshotRefresh()
    return missionControlSnapshotCache
  }

  const fastSnapshot = refreshMissionControlSnapshot({ includeSlowSources: false })
  if ((Date.now() - missionControlSnapshotCacheTs) <= FAST_SNAPSHOT_TTL_MS) {
    scheduleMissionControlSnapshotRefresh()
  }
  return fastSnapshot
}

export function getMissionControlEvents(limit = 60) {
  return getMissionControlSnapshot().events.slice(0, limit)
}

export function getMissionControlAgents() {
  const snapshot = getMissionControlSnapshot()
  return {
    generatedAt: snapshot.generatedAt,
    summary: snapshot.summary,
    agents: snapshot.agents,
    pipeline: snapshot.pipeline,
    heartbeat: snapshot.heartbeat,
    usage: snapshot.usage,
    blocked: snapshot.blocked,
    pipelineInspector: snapshot.pipelineInspector,
    orchestrator: snapshot.orchestrator,
  }
}

export function getMissionControlTasks(limit = 100) {
  return getMissionControlSnapshot().tasks.slice(0, limit)
}
