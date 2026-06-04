import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { getDatabase, db_helpers } from './db'
import { logger } from './logger'
import { getStripeRevenueSnapshot, type MoneyAmount } from './stripe-revenue'

export type MorningApprovalSource =
  | 'mission-control-task'
  | 'mission-control-notification'
  | 'exec-approval'
  | 'athena-notion-snapshot'
  | 'stripe-revenue-snapshot'

export type MorningApprovalDecision = 'approve' | 'needs_changes' | 'defer'

export interface MorningApprovalItem {
  id: string
  source: MorningApprovalSource
  sourceId?: number | string
  title: string
  detail: string
  status: string
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  owner?: string | null
  project?: string | null
  url?: string | null
  options: Array<{ value: MorningApprovalDecision; label: string }>
  metadata?: Record<string, unknown>
  response?: {
    decision: MorningApprovalDecision
    feedback?: string
    actor: string
    respondedAt: number
  }
}

export interface MorningApprovalBrief {
  id: number
  date: string
  title: string
  summary: string
  status: 'prepared' | 'in_review' | 'completed'
  items: MorningApprovalItem[]
  stats: Record<string, number>
  prepared_at: number
  published_at?: number | null
  responded_at?: number | null
  created_by: string
  workspace_id: number
  updated_at: number
}

interface GenerateOptions {
  workspaceId: number
  actor: string
  date?: string
  publish?: boolean
}

interface RespondOptions {
  workspaceId: number
  actor: string
  briefId: number
  itemId: string
  decision: MorningApprovalDecision
  feedback?: string
}

function isoDateLocal(d = new Date()): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function mapBriefRow(row: any): MorningApprovalBrief {
  return {
    ...row,
    items: parseJson<MorningApprovalItem[]>(row.items, []),
    stats: parseJson<Record<string, number>>(row.stats, {}),
  }
}

function optionSet(): MorningApprovalItem['options'] {
  return [
    { value: 'approve', label: 'Approve' },
    { value: 'needs_changes', label: 'Needs changes' },
    { value: 'defer', label: 'Defer' },
  ]
}

function clampText(value: unknown, max = 520): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trim()}...`
}

function priorityRank(priority: string): number {
  return ({ urgent: 5, critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[priority] || 0
}

function sourceRank(source: MorningApprovalSource): number {
  return ({
    'exec-approval': 4,
    'mission-control-task': 3,
    'mission-control-notification': 2,
    'athena-notion-snapshot': 1,
    'stripe-revenue-snapshot': 1,
  } as Record<MorningApprovalSource, number>)[source]
}

async function fetchExecApprovals(): Promise<MorningApprovalItem[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(`http://${config.gatewayHost}:${config.gatewayPort}/api/exec-approvals`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timeout)
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    const approvals = Array.isArray(data?.approvals) ? data.approvals : []
    return approvals
      .filter((approval: any) => approval?.status === 'pending' || !approval?.status)
      .slice(0, 20)
      .map((approval: any): MorningApprovalItem => ({
        id: `exec-${approval.id || approval.requestId || approval.createdAt || Math.random().toString(36).slice(2)}`,
        source: 'exec-approval',
        sourceId: approval.id || approval.requestId,
        title: `${approval.agentName || approval.sessionId || 'Agent'} needs execution approval`,
        detail: clampText(approval.command || approval.toolName || JSON.stringify(approval.toolArgs || {})),
        status: 'pending',
        priority: approval.risk === 'critical' ? 'critical' : approval.risk === 'high' ? 'high' : 'medium',
        owner: approval.agentName || approval.sessionId || null,
        options: optionSet(),
        metadata: {
          toolName: approval.toolName,
          command: approval.command,
          cwd: approval.cwd,
          risk: approval.risk,
        },
      }))
  } catch (err) {
    clearTimeout(timeout)
    logger.warn({ err }, 'Morning approval exec gate collection failed')
    return []
  }
}

function collectTaskGates(workspaceId: number): MorningApprovalItem[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT t.*, p.name as project_name,
      (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id AND c.workspace_id = t.workspace_id) as comment_count
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.workspace_id = ?
      AND (
        t.status IN ('awaiting_owner', 'review', 'quality_review')
        OR (t.status = 'inbox' AND t.priority IN ('critical', 'urgent'))
        OR t.metadata LIKE '%owner%'
        OR t.metadata LIKE '%approval%'
      )
      AND t.status != 'done'
    ORDER BY
      CASE t.priority
        WHEN 'urgent' THEN 5
        WHEN 'critical' THEN 4
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        ELSE 1
      END DESC,
      t.updated_at ASC
    LIMIT 60
  `).all(workspaceId) as any[]

  return rows.map((task): MorningApprovalItem => {
    const metadata = parseJson<Record<string, unknown>>(task.metadata, {})
    return {
      id: `task-${task.id}`,
      source: 'mission-control-task',
      sourceId: task.id,
      title: task.title,
      detail: clampText(task.description || task.outcome || task.error_message || 'Waiting for owner direction.'),
      status: task.status,
      priority: task.priority || 'medium',
      owner: task.assigned_to,
      project: task.project_name,
      url: `/tasks?task=${task.id}`,
      options: optionSet(),
      metadata: {
        commentCount: task.comment_count || 0,
        tags: parseJson<string[]>(task.tags, []),
        ...metadata,
      },
    }
  })
}

function collectNotificationGates(workspaceId: number): MorningApprovalItem[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT *
    FROM notifications
    WHERE workspace_id = ?
      AND read_at IS NULL
      AND (
        type IN ('approval', 'mention', 'assignment', 'morning_approval')
        OR title LIKE '%approval%'
        OR message LIKE '%approval%'
        OR message LIKE '%approve%'
        OR message LIKE '%waiting%'
      )
    ORDER BY created_at DESC
    LIMIT 20
  `).all(workspaceId) as any[]

  return rows.map((notification): MorningApprovalItem => ({
    id: `notification-${notification.id}`,
    source: 'mission-control-notification',
    sourceId: notification.id,
    title: notification.title,
    detail: clampText(notification.message),
    status: notification.read_at ? 'read' : 'unread',
    priority: notification.type === 'approval' ? 'high' : 'medium',
    owner: notification.recipient,
    url: notification.source_type === 'task' && notification.source_id ? `/tasks?task=${notification.source_id}` : '/notifications',
    options: optionSet(),
    metadata: {
      type: notification.type,
      sourceType: notification.source_type,
      sourceId: notification.source_id,
    },
  }))
}

function athenaRootCandidates(): string[] {
  const roots = [
    process.env.ATHENA_ROOT,
    path.join(config.homeDir, 'Desktop', 'Athena (Asus)'),
    path.resolve(process.cwd(), '..'),
  ].filter(Boolean) as string[]
  return [...new Set(roots)]
}

function dataFilesForAthena(): string[] {
  const files: string[] = []
  for (const root of athenaRootCandidates()) {
    files.push(
      path.join(root, 'ATHENA-git', 'content-system', 'brands.json'),
      path.join(root, 'ATHENA-git', 'content-system', 'channels.json'),
      path.join(root, 'ATHENA-git', 'content-system', 'automations.json'),
      path.join(root, 'ATHENA-git', 'content-system', 'content-queue.json'),
      path.join(root, 'athena-content-system', 'discovery', 'migration', 'channels-source.json'),
    )
  }
  return [...new Set(files)].filter((file) => {
    try {
      return fs.existsSync(file) && fs.statSync(file).isFile()
    } catch {
      return false
    }
  })
}

function arrayFromSnapshot(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.results)) return parsed.results
  if (Array.isArray(parsed?.items)) return parsed.items
  if (Array.isArray(parsed?.brands)) return parsed.brands
  if (Array.isArray(parsed?.channels)) return parsed.channels
  if (Array.isArray(parsed?.automations)) return parsed.automations
  if (parsed && typeof parsed === 'object') return Object.values(parsed).filter(v => v && typeof v === 'object')
  return []
}

function recordNeedsOwner(record: any): boolean {
  const text = JSON.stringify(record).toLowerCase()
  const approved = String(record?.['Liz Approved'] ?? record?.lizApproved ?? record?.approved ?? '').toLowerCase()
  const status = String(record?.['Lifecycle Status'] ?? record?.['Channel Status'] ?? record?.status ?? '').toLowerCase()
  return (
    approved === '__no__' ||
    approved === 'no' ||
    approved === 'false' ||
    status.includes('waiting') ||
    status.includes('candidate') ||
    status.includes('review') ||
    text.includes('needs review') ||
    text.includes('needs approval') ||
    text.includes('liz should approve') ||
    text.includes('waiting for liz')
  )
}

function collectAthenaSnapshotGates(): MorningApprovalItem[] {
  const items: MorningApprovalItem[] = []
  for (const file of dataFilesForAthena()) {
    let parsed: any
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }

    const records = arrayFromSnapshot(parsed)
    for (const [index, record] of records.entries()) {
      if (!recordNeedsOwner(record)) continue
      const title =
        record?.Name ||
        record?.name ||
        record?.Title ||
        record?.title ||
        record?.Brand ||
        record?.brand ||
        `ATHENA item ${index + 1}`
      const detail =
        record?.['Review Notes'] ||
        record?.['Approval Notes'] ||
        record?.notes ||
        record?.description ||
        record?.['Next action'] ||
        'Synced ATHENA/Notion snapshot is waiting for owner review.'
      items.push({
        id: `athena-${Buffer.from(`${file}:${index}`).toString('base64url').slice(0, 18)}`,
        source: 'athena-notion-snapshot',
        sourceId: `${path.basename(file)}:${index}`,
        title: clampText(title, 140),
        detail: clampText(detail),
        status: String(record?.['Lifecycle Status'] || record?.['Channel Status'] || record?.status || 'waiting'),
        priority: String(detail).toLowerCase().includes('risk') ? 'high' : 'medium',
        owner: 'Liz',
        url: typeof record?.url === 'string' ? record.url : null,
        options: optionSet(),
        metadata: {
          file,
          platform: record?.Platform,
          brand: record?.Brand,
        },
      })
      if (items.length >= 30) return items
    }
  }
  return items
}

function formatMoney(value: MoneyAmount): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: value.currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(value.amount)
}

async function collectStripeRevenueSnapshot(): Promise<MorningApprovalItem[]> {
  try {
    const snapshot = await getStripeRevenueSnapshot()
    const okAccounts = snapshot.accounts.filter(account => account.status === 'ok')
    if (!snapshot.configured || okAccounts.length === 0) return []

    const totals = snapshot.totals
    const accountLines = okAccounts
      .slice(0, 6)
      .map(account => `${account.name}: ${formatMoney(account.yesterday.net)} net yesterday`)
      .join('; ')

    return [{
      id: `stripe-revenue-${snapshot.generatedAt.slice(0, 10)}`,
      source: 'stripe-revenue-snapshot',
      title: 'Stripe revenue snapshot',
      detail: clampText([
        `Yesterday gross ${formatMoney(totals.yesterday.gross)}, net ${formatMoney(totals.yesterday.net)}.`,
        `Today gross ${formatMoney(totals.today.gross)}, net ${formatMoney(totals.today.net)}.`,
        `Month to date gross ${formatMoney(totals.monthToDate.gross)}, net ${formatMoney(totals.monthToDate.net)}.`,
        `Year to date gross ${formatMoney(totals.yearToDate.gross)}, net ${formatMoney(totals.yearToDate.net)}.`,
        `MRR ${formatMoney(totals.mrr)} and ARR ${formatMoney(totals.arr)} across ${totals.subscriptionCount} active subscriptions.`,
        accountLines ? `Accounts: ${accountLines}.` : '',
      ].filter(Boolean).join(' ')),
      status: 'snapshot',
      priority: 'low',
      owner: 'Liz',
      url: '/revenue',
      options: [],
      metadata: {
        readOnly: true,
        generatedAt: snapshot.generatedAt,
        accountCount: okAccounts.length,
      },
      response: {
        decision: 'approve',
        actor: 'system',
        respondedAt: Math.floor(Date.now() / 1000),
      },
    }]
  } catch (err) {
    logger.warn({ err }, 'Morning approval Stripe revenue snapshot failed')
    return []
  }
}

function computeStats(items: MorningApprovalItem[]): Record<string, number> {
  const stats: Record<string, number> = {
    total: items.length,
    pending: items.filter(item => !item.response).length,
    responded: items.filter(item => !!item.response).length,
  }
  for (const item of items) {
    stats[item.source] = (stats[item.source] || 0) + 1
    stats[`priority:${item.priority}`] = (stats[`priority:${item.priority}`] || 0) + 1
  }
  return stats
}

function summarize(items: MorningApprovalItem[]): string {
  if (items.length === 0) {
    return 'No approval gates were found in Mission Control or the synced ATHENA snapshot.'
  }
  const taskCount = items.filter(i => i.source === 'mission-control-task').length
  const execCount = items.filter(i => i.source === 'exec-approval').length
  const notionCount = items.filter(i => i.source === 'athena-notion-snapshot').length
  const stripeCount = items.filter(i => i.source === 'stripe-revenue-snapshot').length
  const parts = [
    taskCount ? `${taskCount} Mission Control task${taskCount === 1 ? '' : 's'}` : '',
    execCount ? `${execCount} execution approval${execCount === 1 ? '' : 's'}` : '',
    notionCount ? `${notionCount} ATHENA/Notion snapshot item${notionCount === 1 ? '' : 's'}` : '',
    stripeCount ? 'Stripe revenue snapshot' : '',
  ].filter(Boolean)
  return `Morning approval deck prepared with ${items.length} item${items.length === 1 ? '' : 's'}: ${parts.join(', ') || 'mixed gates'}.`
}

function getBriefByDate(workspaceId: number, date: string): MorningApprovalBrief | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT *
    FROM morning_approval_briefs
    WHERE workspace_id = ? AND date = ?
    LIMIT 1
  `).get(workspaceId, date)
  return row ? mapBriefRow(row) : null
}

export function getLatestMorningApprovalBrief(workspaceId: number): MorningApprovalBrief | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT *
    FROM morning_approval_briefs
    WHERE workspace_id = ?
    ORDER BY date DESC, prepared_at DESC
    LIMIT 1
  `).get(workspaceId)
  return row ? mapBriefRow(row) : null
}

function recipientsForWorkspace(workspaceId: number): string[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT username
    FROM users
    WHERE role IN ('admin', 'operator')
      AND (workspace_id = ? OR workspace_id IS NULL)
    ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, username
    LIMIT 10
  `).all(workspaceId) as Array<{ username: string }>
  return rows.map(row => row.username).filter(Boolean)
}

function publishNotifications(brief: MorningApprovalBrief, actor: string): void {
  const db = getDatabase()
  const recipients = recipientsForWorkspace(brief.workspace_id)
  const uniqueRecipients = recipients.length > 0 ? [...new Set(recipients)] : [actor]

  for (const recipient of uniqueRecipients) {
    const existing = db.prepare(`
      SELECT id
      FROM notifications
      WHERE workspace_id = ?
        AND recipient = ?
        AND type = 'morning_approval'
        AND source_type = 'morning_approval'
        AND source_id = ?
      LIMIT 1
    `).get(brief.workspace_id, recipient, brief.id)

    if (existing) continue
    db_helpers.createNotification(
      recipient,
      'morning_approval',
      'Morning approvals are ready',
      `${brief.summary} Open the Morning panel to approve, defer, or leave feedback.`,
      'morning_approval',
      brief.id,
      brief.workspace_id,
    )
  }
}

export async function generateMorningApprovalBrief(options: GenerateOptions): Promise<MorningApprovalBrief> {
  const db = getDatabase()
  const date = options.date || isoDateLocal()
  const now = Math.floor(Date.now() / 1000)
  const existing = getBriefByDate(options.workspaceId, date)
  const previousResponses = new Map<string, MorningApprovalItem['response']>()
  for (const item of existing?.items || []) {
    if (item.response) previousResponses.set(item.id, item.response)
  }

  const items = [
    ...await fetchExecApprovals(),
    ...collectTaskGates(options.workspaceId),
    ...collectNotificationGates(options.workspaceId),
    ...collectAthenaSnapshotGates(),
    ...await collectStripeRevenueSnapshot(),
  ]
    .map(item => previousResponses.has(item.id) ? { ...item, response: previousResponses.get(item.id) } : item)
    .sort((a, b) => {
      const sourceDelta = sourceRank(b.source) - sourceRank(a.source)
      if (sourceDelta !== 0) return sourceDelta
      return priorityRank(b.priority) - priorityRank(a.priority)
    })
    .slice(0, 80)

  const stats = computeStats(items)
  const status = stats.pending === 0 && items.length > 0 ? 'completed' : 'prepared'
  const briefTitle = `Morning approvals - ${date}`
  const summary = summarize(items)
  const publishedAt = options.publish ? now : existing?.published_at ?? null

  db.prepare(`
    INSERT INTO morning_approval_briefs (
      date, title, summary, status, items, stats, prepared_at, published_at,
      created_by, workspace_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, workspace_id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      status = excluded.status,
      items = excluded.items,
      stats = excluded.stats,
      prepared_at = excluded.prepared_at,
      published_at = COALESCE(excluded.published_at, morning_approval_briefs.published_at),
      updated_at = excluded.updated_at
  `).run(
    date,
    briefTitle,
    summary,
    status,
    JSON.stringify(items),
    JSON.stringify(stats),
    now,
    publishedAt,
    options.actor,
    options.workspaceId,
    now,
  )

  const brief = getBriefByDate(options.workspaceId, date)
  if (!brief) throw new Error('Failed to load generated morning approval brief')

  db_helpers.logActivity(
    'morning_approval_prepared',
    'morning_approval',
    brief.id,
    options.actor,
    `Prepared morning approval deck for ${date}`,
    { stats },
    options.workspaceId,
  )

  if (options.publish) publishNotifications(brief, options.actor)
  return brief
}

function commentOnTask(taskId: number, actor: string, content: string, workspaceId: number): void {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO comments (task_id, author, content, created_at, workspace_id)
    VALUES (?, ?, ?, unixepoch(), ?)
  `).run(taskId, actor, content, workspaceId)
}

function applyTaskDecision(item: MorningApprovalItem, opts: RespondOptions): void {
  if (item.source !== 'mission-control-task' || typeof item.sourceId !== 'number') return
  const db = getDatabase()
  const task = db.prepare(`
    SELECT id, title, status, assigned_to
    FROM tasks
    WHERE id = ? AND workspace_id = ?
  `).get(item.sourceId, opts.workspaceId) as { id: number; title: string; status: string; assigned_to: string | null } | undefined
  if (!task) return

  const feedback = opts.feedback?.trim() ? `\n\nFeedback: ${opts.feedback.trim()}` : ''
  if (opts.decision === 'approve') {
    commentOnTask(task.id, opts.actor, `Morning approval: approved by ${opts.actor}.${feedback}`, opts.workspaceId)
    if (task.status === 'awaiting_owner') {
      const nextStatus = task.assigned_to ? 'assigned' : 'inbox'
      db.prepare(`
        UPDATE tasks
        SET status = ?, updated_at = unixepoch()
        WHERE id = ? AND workspace_id = ?
      `).run(nextStatus, task.id, opts.workspaceId)
    }
  } else if (opts.decision === 'needs_changes') {
    commentOnTask(task.id, opts.actor, `Morning approval: changes requested by ${opts.actor}.${feedback}`, opts.workspaceId)
    const nextStatus = task.assigned_to ? 'in_progress' : 'inbox'
    db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = unixepoch()
      WHERE id = ? AND workspace_id = ?
    `).run(nextStatus, task.id, opts.workspaceId)
  } else {
    commentOnTask(task.id, opts.actor, `Morning approval: deferred by ${opts.actor}.${feedback}`, opts.workspaceId)
  }
}

export function respondToMorningApprovalItem(opts: RespondOptions): MorningApprovalBrief {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT *
    FROM morning_approval_briefs
    WHERE id = ? AND workspace_id = ?
    LIMIT 1
  `).get(opts.briefId, opts.workspaceId)

  if (!row) throw new Error('Morning approval brief not found')
  const brief = mapBriefRow(row)
  const now = Math.floor(Date.now() / 1000)
  const item = brief.items.find(candidate => candidate.id === opts.itemId)
  if (!item) throw new Error('Morning approval item not found')

  applyTaskDecision(item, opts)

  const updatedItems = brief.items.map(candidate => candidate.id === opts.itemId
    ? {
        ...candidate,
        response: {
          decision: opts.decision,
          feedback: opts.feedback?.trim() || undefined,
          actor: opts.actor,
          respondedAt: now,
        },
      }
    : candidate
  )
  const stats = computeStats(updatedItems)
  const status = stats.pending === 0 && updatedItems.length > 0 ? 'completed' : 'in_review'

  db.prepare(`
    UPDATE morning_approval_briefs
    SET items = ?, stats = ?, status = ?, responded_at = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(JSON.stringify(updatedItems), JSON.stringify(stats), status, now, now, opts.briefId, opts.workspaceId)

  db_helpers.logActivity(
    'morning_approval_response',
    'morning_approval',
    opts.briefId,
    opts.actor,
    `Morning approval response: ${opts.decision} for ${item.title}`,
    { itemId: opts.itemId, source: item.source, sourceId: item.sourceId },
    opts.workspaceId,
  )

  const updated = db.prepare(`
    SELECT *
    FROM morning_approval_briefs
    WHERE id = ? AND workspace_id = ?
    LIMIT 1
  `).get(opts.briefId, opts.workspaceId)
  return mapBriefRow(updated)
}
