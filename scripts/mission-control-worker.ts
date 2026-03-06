#!/usr/bin/env tsx
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_INTERVAL = 60
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
const DEFAULT_LIMIT = 50
const DEFAULT_MAX_CONCURRENT = 3

interface ParsedArgs {
  _: string[]
  help?: boolean
  agent?: string
  limit?: string
  daemon?: boolean
  interval?: string
  stats?: boolean
  'dry-run'?: boolean
}

class Logger {
  private logFile: string

  constructor(private prefix: string, logDir: string) {
    fs.mkdirSync(logDir, { recursive: true })
    this.logFile = path.join(logDir, `${prefix}-${formatDate(new Date())}.log`)
  }

  log(level: LogLevel, message: string) {
    const timestamp = new Date()
    const formatted = `[${formatTimestamp(timestamp)}] [${level}] ${message}`
    console.log(formatted)
    try {
      fs.appendFileSync(this.logFile, formatted + '\n')
    } catch (err) {
      console.error('Failed to write log:', err)
    }
  }

  debug(message: string) {
    this.log('DEBUG', message)
  }

  info(message: string) {
    this.log('INFO', message)
  }

  warn(message: string) {
    this.log('WARN', message)
  }

  error(message: string) {
    this.log('ERROR', message)
  }
}

class MissionControlError extends Error {
  constructor(public statusCode: number, public url: string, public responseBody: string) {
    super(`HTTP ${statusCode} - ${responseBody || 'no body'}`)
  }
}

class MissionControlClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  getBaseUrl() {
    return this.baseUrl
  }

  private buildUrl(endpoint: string, query?: Record<string, string | number>): URL {
    const resolved = new URL(endpoint, this.baseUrl)
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        resolved.searchParams.set(key, String(value))
      })
    }
    return resolved
  }

  private async request<T>(endpoint: string, method: 'GET' | 'POST', body?: unknown, query?: Record<string, string | number>): Promise<T> {
    const url = this.buildUrl(endpoint, query)
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey
    }

    let payload: string | undefined
    if (body !== undefined) {
      payload = JSON.stringify(body)
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: payload,
    })

    const text = await response.text()

    if (!response.ok) {
      throw new MissionControlError(response.status, url.toString(), text)
    }

    if (!text) {
      return undefined as unknown as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      return undefined as unknown as T
    }
  }

  async get<T>(endpoint: string, query?: Record<string, string | number>): Promise<T> {
    return this.request(endpoint, 'GET', undefined, query)
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request(endpoint, 'POST', body)
  }

  async checkHealth(): Promise<void> {
    await this.get('/api/status')
  }
}

interface NotificationOptions {
  agent?: string
  limit: number
  dryRun: boolean
  daemon: boolean
  interval: number
}

interface HeartbeatOptions {
  agent?: string
  daemon: boolean
  interval: number
  maxConcurrent: number
}

interface AgentSummary {
  id?: string
  name: string
  sessionKey?: string
}

interface NotificationDeliverResponse {
  status?: string
  delivered?: number
  errors?: number
  total_processed?: number
  error_details?: Array<{ recipient?: string; error?: string }>
  statistics?: {
    total?: number
    delivered?: number
    undelivered?: number
    delivery_rate?: number
  }
  agents_with_pending?: Array<{ recipient?: string; pending_count?: number; session_key?: string }>
}

interface HeartbeatResponse {
  status?: string
  total_items?: number
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function formatTimestamp(date: Date) {
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { _: [] }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token === '-h' || token === '--help') {
      result.help = true
      continue
    }

    if (!token.startsWith('--')) {
      result._.push(token)
      continue
    }

    const next = argv[i + 1]
    const hasValue = next !== undefined && !next.startsWith('--')

    switch (token) {
      case '--agent':
        if (hasValue) {
          result.agent = next
          i += 1
        }
        break
      case '--limit':
        if (hasValue) {
          result.limit = next
          i += 1
        }
        break
      case '--interval':
        if (hasValue) {
          result.interval = next
          i += 1
        }
        break
      case '--dry-run':
        result['dry-run'] = true
        break
      case '--daemon':
        result.daemon = true
        break
      case '--stats':
        result.stats = true
        break
      default:
        result._.push(token)
    }
  }

  return result
}

function showHelp() {
  console.log(`Mission Control worker

Usage:
  pnpm worker notifications [--agent NAME] [--limit N] [--dry-run] [--daemon] [--interval SECONDS] [--stats]
  pnpm worker heartbeat [--agent NAME] [--daemon] [--interval SECONDS]

Options:
  --agent NAME      Filter notifications or heartbeat checks to a single agent
  --limit N         Max notifications to process per batch (default: ${DEFAULT_LIMIT})
  --dry-run         Build request but do not deliver notifications
  --daemon          Run in daemon mode (loop with interval)
  --interval SECONDS Polling interval in daemon mode (default: ${DEFAULT_INTERVAL})
  --stats           Show notification delivery statistics and exit
  --help, -h        Show this help message

Environment variables:
  MISSION_CONTROL_URL             Mission Control base URL (default: http://localhost:3000)
  MISSION_CONTROL_SERVICE_API_KEY API key used for service-mode auth
  API_KEY                         Fallback API key when service key is unset
  OPENCLAW_CMD                    Override the OpenClaw CLI path (default: openclaw)
  LOG_DIR                         Directory where logs are stored (default: ~/.mission-control/logs)
`) }

async function ensureMissionControl(client: MissionControlClient, logger: Logger) {
  try {
    await client.checkHealth()
  } catch (err) {
    if (err instanceof MissionControlError) {
      logger.error(
        `Mission Control health check failed at ${err.url} (HTTP ${err.statusCode})`
      )
    } else if (err instanceof Error) {
      logger.error(`Mission Control health check failed: ${err.message}`)
    } else {
      logger.error('Mission Control health check failed with unknown error')
    }
    throw err
  }
}

async function deliverNotifications(
  client: MissionControlClient,
  logger: Logger,
  opts: NotificationOptions
): Promise<boolean> {
  logger.info('Starting notification delivery batch')
  const payload: Record<string, unknown> = { limit: opts.limit }
  if (opts.agent) payload.agent_filter = opts.agent
  if (opts.dryRun) payload.dry_run = true

  const response = await client.post<NotificationDeliverResponse>('/api/notifications/deliver', payload)
  const status = response.status ?? 'unknown'
  const totalProcessed = response.total_processed ?? 0
  const delivered = response.delivered ?? 0
  const errors = response.errors ?? 0

  if (status === 'success') {
    if (totalProcessed > 0) {
      logger.info(`Batch completed: ${totalProcessed} processed, ${delivered} delivered, ${errors} failed`)
      if (errors > 0 && response.error_details && response.error_details.length > 0) {
        logger.warn('Error details:')
        response.error_details.forEach((detail) => {
          const recipient = detail.recipient ?? 'unknown'
          const errorMsg = detail.error ?? 'unknown error'
          logger.warn(`  - ${recipient}: ${errorMsg}`)
        })
      }
    } else {
      logger.info('No notifications to deliver')
    }
    logger.debug('Delivery batch completed successfully')
    return true
  }

  logger.error(`Unexpected delivery response: ${status}`)
  return false
}

async function showNotificationStats(
  client: MissionControlClient,
  logger: Logger,
  agent?: string
): Promise<void> {
  logger.info('Fetching notification delivery statistics')
  const query: Record<string, string> = {}
  if (agent) query.agent = agent

  let response: NotificationDeliverResponse
  try {
    response = await client.get<NotificationDeliverResponse>('/api/notifications/deliver', query)
  } catch (err) {
    if (err instanceof MissionControlError) {
      logger.error(`Failed to fetch delivery statistics (HTTP ${err.statusCode})`)
    } else {
      logger.error(`Failed to fetch delivery statistics: ${(err as Error).message}`)
    }
    throw err
  }

  const stats = response.statistics
  if (stats) {
    logger.info('Delivery Statistics:')
    logger.info(`  Total notifications: ${stats.total ?? 0}`)
    logger.info(`  Delivered: ${stats.delivered ?? 0}`)
    logger.info(`  Undelivered: ${stats.undelivered ?? 0}`)
    logger.info(`  Delivery rate: ${stats.delivery_rate ?? 0}%`)
  } else {
    logger.warn('Delivery statistics not provided by Mission Control')
  }

  logger.info('')
  logger.info('Agents with pending notifications:')
  if (response.agents_with_pending && response.agents_with_pending.length > 0) {
    response.agents_with_pending.forEach((agentData) => {
      const recipient = agentData.recipient ?? 'unknown'
      const pending = agentData.pending_count ?? 0
      const sessionInfo = agentData.session_key ? '' : ' (no session key)'
      logger.info(`  ${recipient}: ${pending} pending${sessionInfo}`)
    })
  } else {
    logger.info('  None')
  }
}

async function runLoop(task: () => Promise<void>, intervalSeconds: number, logger: Logger) {
  let running = true
  const stopHandler = () => {
    if (!running) return
    running = false
    logger.info('Received shutdown signal, stopping worker')
  }

  process.once('SIGINT', stopHandler)
  process.once('SIGTERM', stopHandler)

  while (running) {
    try {
      await task()
    } catch (err) {
      logger.warn(`Task error: ${(err as Error).message ?? 'unknown error'}`)
    }

    if (!running) break
    await sleep(intervalSeconds * 1000)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runNotifications(
  args: ParsedArgs,
  baseUrl: string,
  apiKey: string | undefined,
  logDir: string
) {
  const logger = new Logger('notification-worker', logDir)
  const client = new MissionControlClient(baseUrl, apiKey)

  if (args.stats) {
    await ensureMissionControl(client, logger)
    await showNotificationStats(client, logger, args.agent ? String(args.agent) : undefined)
    return
  }

  const limit = parsePositiveInt(args.limit, DEFAULT_LIMIT, 'limit', logger)
  const interval = parsePositiveInt(args.interval, DEFAULT_INTERVAL, 'interval', logger)
  const options: NotificationOptions = {
    agent: args.agent ? String(args.agent) : undefined,
    limit,
    dryRun: Boolean(args['dry-run']),
    daemon: Boolean(args.daemon),
    interval,
  }

  const job = async () => {
    await ensureMissionControl(client, logger)
    const success = await deliverNotifications(client, logger, options)
    if (!success) {
      throw new Error('Notification delivery failed')
    }
    logger.info('Notification delivery completed successfully')
  }

  if (options.daemon) {
    logger.info(`Starting notification worker (daemon mode, PID: ${process.pid})`)
    await runLoop(job, options.interval, logger)
  } else {
    logger.info('Starting single notification delivery run')
    await job()
  }
}

function parsePositiveInt(
  value: string | boolean | undefined,
  fallback: number,
  label: string,
  logger: Logger
): number {
  if (value === undefined || value === true) {
    return fallback
  }

  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    logger.error(`Invalid --${label}: ${value}`)
    throw new Error(`Invalid --${label}`)
  }

  return numeric
}

async function runHeartbeat(
  args: ParsedArgs,
  baseUrl: string,
  apiKey: string | undefined,
  logDir: string
) {
  const logger = new Logger('heartbeat-worker', logDir)
  const client = new MissionControlClient(baseUrl, apiKey)

  const interval = parsePositiveInt(args.interval, DEFAULT_INTERVAL, 'interval', logger)
  const options: HeartbeatOptions = {
    agent: args.agent ? String(args.agent) : undefined,
    daemon: Boolean(args.daemon),
    interval,
    maxConcurrent: parseMaxConcurrent(() => DEFAULT_MAX_CONCURRENT, logger),
  }

  const job = async () => {
    logger.info(`Starting agent heartbeat check (PID: ${process.pid})`)
    await ensureMissionControl(client, logger)
    await executeHeartbeat(client, logger, options)
  }

  if (options.daemon) {
    await runLoop(job, options.interval, logger)
  } else {
    await job()
  }
}

function parseMaxConcurrent(defaultFactory: () => number, logger: Logger): number {
  const envValue = process.env.MAX_CONCURRENT
  if (!envValue) {
    return defaultFactory()
  }

  const numeric = Number(envValue)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    logger.warn(`Invalid MAX_CONCURRENT: ${envValue}, using default`)
    return defaultFactory()
  }

  return numeric
}

async function executeHeartbeat(client: MissionControlClient, logger: Logger, opts: HeartbeatOptions) {
  const agents = await fetchAgents(client, logger)
  const filtered = filterAgents(agents, opts.agent)

  if (filtered.length === 0) {
    logger.warn('No agents found with session keys configured')
    return
  }

  logger.info(`Checking heartbeat for ${filtered.length} agent(s)`)

  let index = 0
  let processed = 0
  let successful = 0
  let failed = 0

  const worker = async () => {
    while (index < filtered.length) {
      const idx = index
      index += 1
      const agent = filtered[idx]
      try {
        await checkAgentHeartbeat(client, logger, agent)
        successful += 1
      } catch (err) {
        failed += 1
        logger.error(`Heartbeat failure for ${agent.name}: ${(err as Error).message}`)
      } finally {
        processed += 1
      }
    }
  }

  const concurrency = Math.min(opts.maxConcurrent, filtered.length)
  const workers = new Array(concurrency).fill(null).map(() => worker())
  await Promise.all(workers)

  logger.info(`Heartbeat check completed: ${processed} processed, ${successful} successful, ${failed} failed`)
  if (failed > 0) {
    throw new Error('Heartbeat run encountered errors')
  }
}

function filterAgents(agents: AgentSummary[], filter?: string) {
  const sessionAgents = agents.filter((agent) => Boolean(agent.sessionKey))
  if (!filter) {
    return sessionAgents
  }

  return sessionAgents.filter((agent) => agent.name === filter)
}

async function fetchAgents(client: MissionControlClient, logger: Logger): Promise<AgentSummary[]> {
  try {
    const response = await client.get<{ agents?: Array<Record<string, unknown>> }>('/api/agents', { limit: 100 })
    const list = response.agents ?? []
    return list
      .map((entry) => ({
        id: String(entry.id ?? entry.name ?? '').trim() || undefined,
        name: String(entry.name ?? entry.id ?? '').trim(),
        sessionKey: String(entry.session_key ?? entry.sessionKey ?? '').trim() || undefined,
      }))
      .filter((agent) => Boolean(agent.name))
  } catch (err) {
    if (err instanceof MissionControlError) {
      logger.error(`Failed to fetch agents list: HTTP ${err.statusCode}`)
    } else {
      logger.error(`Failed to fetch agents list: ${(err as Error).message}`)
    }
    throw err
  }
}

async function checkAgentHeartbeat(client: MissionControlClient, logger: Logger, agent: AgentSummary) {
  logger.info(`Checking heartbeat for agent: ${agent.name}`)
  const agentId = agent.id ?? agent.name

  const response = await client.get<HeartbeatResponse>(`/api/agents/${encodeURIComponent(agentId)}/heartbeat`)
  const status = response.status ?? 'unknown'

  if (status === 'HEARTBEAT_OK') {
    logger.info(`Agent ${agent.name}: No work items found`)
    return
  }

  if (status === 'WORK_ITEMS_FOUND') {
    const totalItems = response.total_items ?? 0
    logger.info(`Agent ${agent.name}: Found ${totalItems} work items`)
    if (agent.sessionKey) {
      await sendWakeNotification(agent, client, logger, totalItems)
    } else {
      logger.warn(`Agent ${agent.name} has work items but no session key configured`)
    }
    return
  }

  throw new Error(`Unexpected heartbeat response: ${status}`)
}

async function sendWakeNotification(
  agent: AgentSummary,
  client: MissionControlClient,
  logger: Logger,
  workItemsCount: number
) {
  const sessionKey = agent.sessionKey
  if (!sessionKey) return

  const openclawCmd = process.env.OPENCLAW_CMD || 'openclaw'
  const wakeMessage = [
    '🤖 **Mission Control Heartbeat**',
    '',
    `Agent: ${agent.name}`,
    `Work items found: ${workItemsCount}`,
    '',
    '🔔 You have notifications or tasks that need attention.',
    `Use Mission Control to view details: ${client.getBaseUrl()}`,
    '',
    `⏰ ${formatTimestamp(new Date())}`,
  ].join('\n')

  try {
    await execFileAsync(openclawCmd, ['gateway', 'sessions_send', '--session', sessionKey, '--message', wakeMessage])
    logger.info(`Wake notification sent successfully to ${agent.name}`)
  } catch (err) {
    logger.error(`Failed to send wake notification to ${agent.name}: ${(err as Error).message}`)
  }
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2)
  const args = parseArgs(rawArgs)
  const logDir = process.env.LOG_DIR || path.join(os.homedir(), '.mission-control', 'logs')
  const baseUrl = (process.env.MISSION_CONTROL_URL || 'http://localhost:3000').trim()
  const apiKey = (process.env.MISSION_CONTROL_SERVICE_API_KEY || process.env.API_KEY || '').trim() || undefined

  if (!command || args.help) {
    showHelp()
    if (!command) {
      process.exitCode = 1
    }
    return
  }

  const task = command.toLowerCase()
  if (task === 'notifications') {
    await runNotifications(args, baseUrl, apiKey, logDir)
  } else if (task === 'heartbeat') {
    await runHeartbeat(args, baseUrl, apiKey, logDir)
  } else {
    console.error(`Unknown task: ${command}`)
    showHelp()
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
