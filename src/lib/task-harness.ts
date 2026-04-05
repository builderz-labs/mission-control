import { getDatabase } from '@/lib/db'
import { getPrimarySubscription } from '@/lib/provider-subscriptions'

export const TASK_STATUSES = [
  'backlog',
  'inbox',
  'assigned',
  'preflight',
  'ready',
  'in_progress',
  'review',
  'verify',
  'quality_review',
  'owner_gate_review',
  'blocked_env',
  'blocked_approval',
  'needs_owner',
  'recovering',
  'queued_for_budget_window',
  'degraded_execution',
  'handoff',
  'awaiting_owner',
  'done',
  'failed',
  'failed_terminal',
] as const

export type TaskLifecycleStatus = typeof TASK_STATUSES[number]

export interface HarnessMetadata {
  step?: string
  aegis_review_failures?: number
  preflight?: {
    checked_at?: number
    ok?: boolean
    checks?: Array<{ name: string; ok: boolean; detail?: string }>
  }
  blockers?: Array<{ class: string; reason: string; detail?: string }>
  artifacts?: Record<string, unknown>
  verification?: { status?: string; notes?: string; at?: number }
  resume?: { instructions?: string; reset_at?: number | null }
  failure_signature?: string
}

export interface TaskMetadataShape {
  implementation_repo?: string
  code_location?: string
  target_session?: string
  dispatch_session_id?: string
  owner_candidate?: boolean
  owner_required_reason?: string
  owner_action?: string
  owner_blocking_asset?: string
  caio_gate_decision?: string
  caio_attempted_actions?: string[]
  fallback_route?: {
    original_model?: string | null
    selected_model?: string | null
    reason?: string
    reset_at?: number | null
  }
  model_budget?: {
    provider?: string
    plan?: string
    daily_used?: number
    weekly_used?: number
    daily_limit?: number
    weekly_limit?: number
    reserved_ratio?: number
  }
  harness?: HarnessMetadata
  [key: string]: unknown
}

const TRUE_OWNER_KEYWORDS = [
  'api key',
  'api_key',
  'apikey',
  'token',
  'secret',
  'credential',
  'oauth',
  'login',
  'sign in',
  'billing',
  'payment',
  'invoice',
  '법무',
  '결제',
  '로그인',
  '시크릿',
  '토큰 발급',
  '키 발급',
  '키 등록',
  '외부 콘솔',
  'human-only',
]

export function parseTaskMetadata(raw: string | null | undefined): TaskMetadataShape {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TaskMetadataShape
    }
  } catch {
    // Ignore malformed metadata.
  }
  return {}
}

export function serializeTaskMetadata(metadata: TaskMetadataShape): string {
  return JSON.stringify(metadata)
}

export function hasOwnerQueueEvidence(metadata: TaskMetadataShape | null | undefined): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  if (metadata.owner_candidate === true) return true
  if (typeof metadata.owner_required_reason === 'string' && metadata.owner_required_reason.trim()) return true
  if (metadata.owner_queue_kind === 'owner_only' || metadata.owner_queue_kind === 'auto_guard') return true
  if (typeof metadata.owner_queue_entered_at === 'number' && Number.isFinite(metadata.owner_queue_entered_at)) return true
  const harness = metadata.harness
  if (harness && typeof harness === 'object' && harness.step === 'needs_owner') return true
  return false
}

export function buildFailureSignature(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(' | ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}

export function isTrueOwnerRequired(task: {
  title: string
  description?: string | null
  error_message?: string | null
  metadata?: TaskMetadataShape | string | null
}): boolean {
  const metadata = typeof task.metadata === 'string' ? parseTaskMetadata(task.metadata) : (task.metadata ?? {})
  if (metadata.owner_required_reason) return true

  const text = [
    task.title,
    task.description || '',
    task.error_message || '',
    metadata.owner_action || '',
    metadata.owner_blocking_asset || '',
  ].join(' ').toLowerCase()

  return TRUE_OWNER_KEYWORDS.some((kw) => text.includes(kw))
}

function getSettingNumber(db: ReturnType<typeof getDatabase>, key: string, fallback: number): number {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
    if (!row?.value) return fallback
    const parsed = Number(row.value)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function getSettingBoolean(db: ReturnType<typeof getDatabase>, key: string, fallback: boolean): boolean {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
    if (!row?.value) return fallback
    return row.value === 'true'
  } catch {
    return fallback
  }
}

export interface BudgetDecision {
  action: 'proceed' | 'fallback' | 'queue'
  selectedModel: string | null
  reason?: string
  resetAt?: number | null
  budget?: TaskMetadataShape['model_budget']
}

export function decideBudgetRoute(args: {
  taskId: number
  priority: string
  preferredModel: string | null
  fallbackModel: string | null
  workspaceId: number
}): BudgetDecision {
  const { taskId, priority, preferredModel, fallbackModel, workspaceId } = args
  if (!preferredModel) return { action: 'proceed', selectedModel: null }

  const db = getDatabase()
  const enabled = getSettingBoolean(db, 'general.model_budget_guard', true)
  if (!enabled) return { action: 'proceed', selectedModel: preferredModel }

  const provider = preferredModel.includes('gpt') || preferredModel.includes('openai') ? 'openai' : 'anthropic'
  const subscription = getPrimarySubscription()
  const plan = subscription?.provider === provider ? subscription.type : subscription?.provider === 'openai' && provider === 'openai' ? subscription.type : null
  const now = Math.floor(Date.now() / 1000)
  const startOfDay = now - 86_400
  const startOfWeek = now - 7 * 86_400
  const dailyUsed = Number((db.prepare(`
    SELECT COUNT(*) as count FROM token_usage
    WHERE workspace_id = ? AND task_id IS NOT NULL AND created_at >= ? AND lower(model) LIKE ?
  `).get(workspaceId, startOfDay, provider === 'openai' ? '%gpt%' : '%claude%') as { count?: number } | undefined)?.count ?? 0)
  const weeklyUsed = Number((db.prepare(`
    SELECT COUNT(*) as count FROM token_usage
    WHERE workspace_id = ? AND task_id IS NOT NULL AND created_at >= ? AND lower(model) LIKE ?
  `).get(workspaceId, startOfWeek, provider === 'openai' ? '%gpt%' : '%claude%') as { count?: number } | undefined)?.count ?? 0)

  const dailyLimit = getSettingNumber(db, `subscription.${provider}_daily_limit`, provider === 'openai' ? 120 : 240)
  const weeklyLimit = getSettingNumber(db, `subscription.${provider}_weekly_limit`, provider === 'openai' ? 600 : 1200)
  const reservedRatio = getSettingNumber(db, 'general.model_budget_reserved_ratio', 20) / 100
  const reservedDaily = Math.ceil(dailyLimit * reservedRatio)
  const reservedWeekly = Math.ceil(weeklyLimit * reservedRatio)
  const isCritical = priority === 'critical' || priority === 'high'

  const budget = { provider, plan: plan || undefined, daily_used: dailyUsed, weekly_used: weeklyUsed, daily_limit: dailyLimit, weekly_limit: weeklyLimit, reserved_ratio: reservedRatio }
  const dailyRemaining = dailyLimit - dailyUsed
  const weeklyRemaining = weeklyLimit - weeklyUsed
  const resetAt = now + 6 * 60 * 60

  if (isCritical) {
    if (dailyRemaining <= 0 || weeklyRemaining <= 0) {
      return {
        action: fallbackModel ? 'fallback' : 'queue',
        selectedModel: fallbackModel,
        resetAt,
        reason: 'critical task routed under exhausted budget',
        budget,
      }
    }
    return { action: 'proceed', selectedModel: preferredModel, budget }
  }

  if (dailyRemaining <= reservedDaily || weeklyRemaining <= reservedWeekly) {
    if (fallbackModel) {
      return {
        action: 'fallback',
        selectedModel: fallbackModel,
        resetAt,
        reason: 'reserved premium budget preserved for critical and verification tasks',
        budget,
      }
    }
    return {
      action: 'queue',
      selectedModel: null,
      resetAt,
      reason: 'premium budget reserved for critical work',
      budget,
    }
  }

  return { action: 'proceed', selectedModel: preferredModel, budget }
}

export function deriveFallbackModel(model: string | null): string | null {
  if (!model) return null
  if (model.includes('opus')) return '9router/cc/claude-sonnet-4-6'
  if (model.includes('gpt-5') || model.includes('openai')) return 'gpt-5-mini'
  if (model.includes('sonnet')) return '9router/cc/claude-haiku-4-5-20251001'
  return null
}
