import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { join } from 'path'
import { readFile, writeFile, rename } from 'fs/promises'
import { execFileSync } from 'child_process'

// ---------------------------------------------------------------------------
// Integration registry
// ---------------------------------------------------------------------------

interface IntegrationDef {
  id: string
  name: string
  category: 'ai' | 'search' | 'social' | 'messaging' | 'devtools' | 'security' | 'infra'
  envVars: string[]
  vaultItem?: string // 1Password item name
  testable?: boolean
}

const INTEGRATIONS: IntegrationDef[] = [
  // AI Providers
  { id: 'anthropic', name: 'Anthropic', category: 'ai', envVars: ['ANTHROPIC_API_KEY'], vaultItem: 'openclaw-anthropic-api-key', testable: true },
  { id: 'openai', name: 'OpenAI', category: 'ai', envVars: ['OPENAI_API_KEY'], vaultItem: 'openclaw-openai-api-key', testable: true },
  { id: 'openrouter', name: 'OpenRouter', category: 'ai', envVars: ['OPENROUTER_API_KEY'], vaultItem: 'openclaw-openrouter-api-key', testable: true },
  { id: 'nvidia', name: 'NVIDIA', category: 'ai', envVars: ['NVIDIA_API_KEY'], vaultItem: 'openclaw-nvidia-api-key' },
  { id: 'moonshot', name: 'Moonshot / Kimi', category: 'ai', envVars: ['MOONSHOT_API_KEY'], vaultItem: 'openclaw-moonshot-api-key' },
  { id: 'ollama', name: 'Ollama (Local)', category: 'ai', envVars: ['OLLAMA_API_KEY'], vaultItem: 'openclaw-ollama-api-key' },

  // Search
  { id: 'brave', name: 'Brave Search', category: 'search', envVars: ['BRAVE_API_KEY'], vaultItem: 'openclaw-brave-api-key' },

  // Social
  { id: 'x_twitter', name: 'X / Twitter', category: 'social', envVars: ['X_COOKIES_PATH'] },
  { id: 'linkedin', name: 'LinkedIn', category: 'social', envVars: ['LINKEDIN_ACCESS_TOKEN'] },

  // Messaging
  { id: 'telegram_jarv', name: 'Telegram (Jarv)', category: 'messaging', envVars: ['TELEGRAM_BOT_TOKEN_JARV'], vaultItem: 'openclaw-telegram-bot-token-jarv', testable: true },
  { id: 'telegram_forge', name: 'Telegram (Forge)', category: 'messaging', envVars: ['TELEGRAM_BOT_TOKEN_FORGE'], vaultItem: 'openclaw-telegram-bot-token-forge', testable: true },
  { id: 'telegram_nefes', name: 'Telegram (Nefes)', category: 'messaging', envVars: ['TELEGRAM_BOT_TOKEN_NEFES'], vaultItem: 'openclaw-telegram-bot-token-nefes', testable: true },
  { id: 'telegram_ops', name: 'Telegram (Ops)', category: 'messaging', envVars: ['TELEGRAM_BOT_TOKEN_OPS'], vaultItem: 'openclaw-telegram-bot-token-ops', testable: true },

  // Dev Tools
  { id: 'github', name: 'GitHub', category: 'devtools', envVars: ['GITHUB_TOKEN'], vaultItem: 'openclaw-github-token', testable: true },

  // Security
  { id: 'onepassword', name: '1Password', category: 'security', envVars: ['OP_SERVICE_ACCOUNT_TOKEN'] },

  // Infrastructure
  { id: 'gateway', name: 'Gateway Auth', category: 'infra', envVars: ['OPENCLAW_GATEWAY_TOKEN'], vaultItem: 'openclaw-openclaw-gateway-token' },
]

// Category metadata
const CATEGORIES: Record<string, { label: string; order: number }> = {
  ai: { label: 'AI Providers', order: 0 },
  search: { label: 'Search', order: 1 },
  social: { label: 'Social', order: 2 },
  messaging: { label: 'Messaging', order: 3 },
  devtools: { label: 'Dev Tools', order: 4 },
  security: { label: 'Security', order: 5 },
  infra: { label: 'Infrastructure', order: 6 },
}

// Vars that must never be written via this API
const BLOCKED_VARS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'PWD', 'LOGNAME', 'HOSTNAME',
])
const BLOCKED_PREFIXES = ['LD_', 'DYLD_']

// ---------------------------------------------------------------------------
// .env parser  — preserves comments, blanks, and ordering
// ---------------------------------------------------------------------------

interface EnvLine {
  type: 'comment' | 'blank' | 'var'
  raw: string
  key?: string
  value?: string
}

function parseEnv(content: string): EnvLine[] {
  const lines: EnvLine[] = []
  for (const raw of content.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      lines.push({ type: 'blank', raw })
    } else if (trimmed.startsWith('#')) {
      lines.push({ type: 'comment', raw })
    } else {
      const eqIdx = raw.indexOf('=')
      if (eqIdx > 0) {
        const key = raw.slice(0, eqIdx).trim()
        const value = raw.slice(eqIdx + 1).trim()
        lines.push({ type: 'var', raw, key, value })
      } else {
        lines.push({ type: 'comment', raw }) // malformed line preserved as-is
      }
    }
  }
  return lines
}

function serializeEnv(lines: EnvLine[]): string {
  return lines.map(l => {
    if (l.type === 'var') return `${l.key}=${l.value}`
    return l.raw
  }).join('\n')
}

function getEnvPath(): string | null {
  if (!config.openclawHome) return null
  return join(config.openclawHome, '.env')
}

async function readEnvFile(): Promise<{ lines: EnvLine[]; raw: string } | null> {
  const envPath = getEnvPath()
  if (!envPath) return null
  try {
    const raw = await readFile(envPath, 'utf-8')
    return { lines: parseEnv(raw), raw }
  } catch (err: any) {
    if (err.code === 'ENOENT') return { lines: [], raw: '' }
    throw err
  }
}

async function writeEnvFile(lines: EnvLine[]): Promise<void> {
  const envPath = getEnvPath()!
  const tmpPath = envPath + '.tmp'
  const content = serializeEnv(lines)
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, envPath)
}

function redactValue(value: string): string {
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

function isVarBlocked(key: string): boolean {
  if (BLOCKED_VARS.has(key)) return true
  return BLOCKED_PREFIXES.some(p => key.startsWith(p))
}

// Uses execFileSync (no shell) to avoid command injection
function checkOpAvailable(): boolean {
  try {
    execFileSync('which', ['op'], { stdio: 'pipe', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/**
 * Build env for op CLI. The OP_SERVICE_ACCOUNT_TOKEN may live in the
 * OpenClaw .env (not the MC .env that systemd loads). Read it at
 * runtime so the op CLI can authenticate.
 */
async function getOpEnv(): Promise<NodeJS.ProcessEnv> {
  const base: NodeJS.ProcessEnv = { ...process.env }
  // Already in process env? Use it.
  if (base.OP_SERVICE_ACCOUNT_TOKEN) return base
  // Try reading from the OpenClaw .env
  const envData = await readEnvFile()
  if (envData) {
    for (const line of envData.lines) {
      if (line.type === 'var' && line.key === 'OP_SERVICE_ACCOUNT_TOKEN' && line.value) {
        base.OP_SERVICE_ACCOUNT_TOKEN = line.value
        break
      }
    }
  }
  return base
}

// ---------------------------------------------------------------------------
// GET /api/integrations — list all integrations with status + redacted values
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
  }

  const envMap = new Map<string, string>()
  for (const line of envData.lines) {
    if (line.type === 'var' && line.key) {
      envMap.set(line.key, line.value!)
    }
  }

  const opAvailable = checkOpAvailable()

  const integrations = INTEGRATIONS.map(def => {
    const vars: Record<string, { redacted: string; set: boolean }> = {}
    let allSet = true
    let anySet = false

    for (const envVar of def.envVars) {
      const val = envMap.get(envVar)
      if (val && val.length > 0) {
        vars[envVar] = { redacted: redactValue(val), set: true }
        anySet = true
      } else {
        vars[envVar] = { redacted: '', set: false }
        allSet = false
      }
    }

    const status = allSet && anySet ? 'connected' : anySet ? 'partial' : 'not_configured'

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      categoryLabel: CATEGORIES[def.category]?.label ?? def.category,
      envVars: vars,
      status,
      vaultItem: def.vaultItem ?? null,
      testable: def.testable ?? false,
    }
  })

  return NextResponse.json({
    integrations,
    categories: Object.entries(CATEGORIES)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, meta]) => ({ id, label: meta.label })),
    opAvailable,
    envPath: getEnvPath(),
  })
}

// ---------------------------------------------------------------------------
// PUT /api/integrations — update/add env vars
// Body: { vars: { KEY: "value", ... } }
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body?.vars || typeof body.vars !== 'object') {
    return NextResponse.json({ error: 'vars object required' }, { status: 400 })
  }

  for (const key of Object.keys(body.vars)) {
    if (isVarBlocked(key)) {
      return NextResponse.json({ error: `Cannot set protected variable: ${key}` }, { status: 403 })
    }
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      return NextResponse.json({ error: `Invalid variable name: ${key}` }, { status: 400 })
    }
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
  }

  const { lines } = envData
  const updatedKeys: string[] = []

  for (const [key, value] of Object.entries(body.vars)) {
    const strValue = String(value)
    const existing = lines.find(l => l.type === 'var' && l.key === key)

    if (existing) {
      existing.value = strValue
    } else {
      if (lines.length > 0 && lines[lines.length - 1].type !== 'blank') {
        lines.push({ type: 'blank', raw: '' })
      }
      lines.push({ type: 'var', raw: `${key}=${strValue}`, key, value: strValue })
    }
    updatedKeys.push(key)
  }

  await writeEnvFile(lines)

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'integrations_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { updated_keys: updatedKeys },
    ip_address: ipAddress,
  })

  return NextResponse.json({ updated: updatedKeys, count: updatedKeys.length })
}

// ---------------------------------------------------------------------------
// DELETE /api/integrations?keys=KEY1,KEY2 — remove env vars
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const keysParam = searchParams.get('keys')
  if (!keysParam) {
    return NextResponse.json({ error: 'keys parameter required (comma-separated)' }, { status: 400 })
  }

  const keysToRemove = new Set(keysParam.split(',').map(k => k.trim()).filter(Boolean))
  if (keysToRemove.size === 0) {
    return NextResponse.json({ error: 'At least one key required' }, { status: 400 })
  }

  for (const key of keysToRemove) {
    if (isVarBlocked(key)) {
      return NextResponse.json({ error: `Cannot remove protected variable: ${key}` }, { status: 403 })
    }
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
  }

  const removed: string[] = []
  const newLines = envData.lines.filter(l => {
    if (l.type === 'var' && l.key && keysToRemove.has(l.key)) {
      removed.push(l.key)
      return false
    }
    return true
  })

  if (removed.length > 0) {
    await writeEnvFile(newLines)
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'integrations_remove',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { removed_keys: removed },
    ip_address: ipAddress,
  })

  return NextResponse.json({ removed, count: removed.length })
}

// ---------------------------------------------------------------------------
// POST /api/integrations — action dispatcher (test, pull)
// Body: { action: "test"|"pull", integrationId: "..." }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body?.action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  // pull-all is a batch action — no integrationId needed
  if (body.action === 'pull-all') {
    return handlePullAll(request, auth.user, body.category as string | undefined)
  }

  if (!body.integrationId) {
    return NextResponse.json({ error: 'integrationId required' }, { status: 400 })
  }

  const integration = INTEGRATIONS.find(i => i.id === body.integrationId)
  if (!integration) {
    return NextResponse.json({ error: `Unknown integration: ${body.integrationId}` }, { status: 404 })
  }

  if (body.action === 'test') {
    return handleTest(integration, request, auth.user)
  }

  if (body.action === 'pull') {
    return handlePull(integration, request, auth.user)
  }

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
}

// ---------------------------------------------------------------------------
// Test connection for an integration
// ---------------------------------------------------------------------------

async function handleTest(
  integration: IntegrationDef,
  request: NextRequest,
  user: { username: string; id: number }
) {
  if (!integration.testable) {
    return NextResponse.json({ error: 'This integration does not support testing' }, { status: 400 })
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
  }

  const envMap = new Map<string, string>()
  for (const line of envData.lines) {
    if (line.type === 'var' && line.key) envMap.set(line.key, line.value!)
  }

  try {
    let result: { ok: boolean; detail: string }

    switch (integration.id) {
      case 'telegram_jarv':
      case 'telegram_forge':
      case 'telegram_nefes':
      case 'telegram_ops': {
        const token = envMap.get(integration.envVars[0])
        if (!token) return NextResponse.json({ ok: false, detail: 'Token not set' })
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) })
        const data = await res.json()
        result = data.ok
          ? { ok: true, detail: `Bot: @${data.result.username}` }
          : { ok: false, detail: data.description || 'Failed' }
        break
      }

      case 'github': {
        const token = envMap.get('GITHUB_TOKEN')
        if (!token) return NextResponse.json({ ok: false, detail: 'Token not set' })
        const res = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'MissionControl/1.0' },
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const data = await res.json()
          result = { ok: true, detail: `User: ${data.login}` }
        } else {
          result = { ok: false, detail: `HTTP ${res.status}` }
        }
        break
      }

      case 'anthropic': {
        const key = envMap.get('ANTHROPIC_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(5000),
        })
        result = res.ok
          ? { ok: true, detail: 'API key valid' }
          : { ok: false, detail: `HTTP ${res.status}` }
        break
      }

      case 'openai': {
        const key = envMap.get('OPENAI_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        })
        result = res.ok
          ? { ok: true, detail: 'API key valid' }
          : { ok: false, detail: `HTTP ${res.status}` }
        break
      }

      case 'openrouter': {
        const key = envMap.get('OPENROUTER_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        })
        result = res.ok
          ? { ok: true, detail: 'API key valid' }
          : { ok: false, detail: `HTTP ${res.status}` }
        break
      }

      default:
        return NextResponse.json({ error: 'Test not implemented for this integration' }, { status: 400 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'integration_test',
      actor: user.username,
      actor_id: user.id,
      detail: { integration: integration.id, result: result.ok ? 'success' : 'failed' },
      ip_address: ipAddress,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, detail: err.message || 'Connection failed' })
  }
}

// ---------------------------------------------------------------------------
// Pull value from 1Password vault — uses execFileSync (no shell) for safety
// ---------------------------------------------------------------------------

async function handlePull(
  integration: IntegrationDef,
  request: NextRequest,
  user: { username: string; id: number }
) {
  if (!integration.vaultItem) {
    return NextResponse.json({ error: 'No vault item configured for this integration' }, { status: 400 })
  }

  if (!checkOpAvailable()) {
    return NextResponse.json({ error: '1Password CLI (op) is not installed' }, { status: 400 })
  }

  try {
    const opEnv = await getOpEnv()
    if (!opEnv.OP_SERVICE_ACCOUNT_TOKEN) {
      return NextResponse.json({ error: 'OP_SERVICE_ACCOUNT_TOKEN not found in environment or .env' }, { status: 400 })
    }

    // execFileSync passes args as array — no shell interpolation possible
    const secret = execFileSync('op', [
      'item', 'get', integration.vaultItem,
      '--vault', process.env.OP_VAULT_NAME || 'default',
      '--fields', 'password',
      '--format', 'json',
    ], { timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], env: opEnv }).toString().trim()

    let value: string
    try {
      const parsed = JSON.parse(secret)
      value = parsed.value || parsed
    } catch {
      value = secret
    }

    if (!value || value.length === 0) {
      return NextResponse.json({ error: 'Empty value returned from 1Password' }, { status: 400 })
    }

    // Write to .env
    const envData = await readEnvFile()
    if (!envData) {
      return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
    }

    const { lines } = envData
    const envVar = integration.envVars[0]

    const existing = lines.find(l => l.type === 'var' && l.key === envVar)
    if (existing) {
      existing.value = value
    } else {
      if (lines.length > 0 && lines[lines.length - 1].type !== 'blank') {
        lines.push({ type: 'blank', raw: '' })
      }
      lines.push({ type: 'var', raw: `${envVar}=${value}`, key: envVar, value })
    }

    await writeEnvFile(lines)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'integration_pull_1password',
      actor: user.username,
      actor_id: user.id,
      detail: { integration: integration.id, env_var: envVar },
      ip_address: ipAddress,
    })

    return NextResponse.json({
      ok: true,
      detail: `Pulled ${envVar} from 1Password`,
      redacted: redactValue(value),
    })
  } catch (err: any) {
    return NextResponse.json({
      error: `1Password pull failed: ${err.message}`,
    }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Pull ALL vault-backed integrations from 1Password (optionally by category)
// ---------------------------------------------------------------------------

async function handlePullAll(
  request: NextRequest,
  user: { username: string; id: number },
  category?: string,
) {
  if (!checkOpAvailable()) {
    return NextResponse.json({ error: '1Password CLI (op) is not installed' }, { status: 400 })
  }

  const opEnv = await getOpEnv()
  if (!opEnv.OP_SERVICE_ACCOUNT_TOKEN) {
    return NextResponse.json({ error: 'OP_SERVICE_ACCOUNT_TOKEN not found in environment or .env' }, { status: 400 })
  }

  const targets = INTEGRATIONS.filter(i => {
    if (!i.vaultItem) return false
    if (category && i.category !== category) return false
    return true
  })

  if (targets.length === 0) {
    return NextResponse.json({ error: 'No vault-backed integrations found for this category' }, { status: 400 })
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
  }

  const { lines } = envData
  const results: { id: string; envVar: string; ok: boolean; detail: string }[] = []

  for (const integration of targets) {
    const envVar = integration.envVars[0]
    try {
      const secret = execFileSync('op', [
        'item', 'get', integration.vaultItem!,
        '--vault', process.env.OP_VAULT_NAME || 'default',
        '--fields', 'password',
        '--format', 'json',
      ], { timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], env: opEnv }).toString().trim()

      let value: string
      try {
        const parsed = JSON.parse(secret)
        value = parsed.value || parsed
      } catch {
        value = secret
      }

      if (!value || value.length === 0) {
        results.push({ id: integration.id, envVar, ok: false, detail: 'Empty value' })
        continue
      }

      // Upsert into lines
      const existing = lines.find(l => l.type === 'var' && l.key === envVar)
      if (existing) {
        existing.value = value
      } else {
        if (lines.length > 0 && lines[lines.length - 1].type !== 'blank') {
          lines.push({ type: 'blank', raw: '' })
        }
        lines.push({ type: 'var', raw: `${envVar}=${value}`, key: envVar, value })
      }

      results.push({ id: integration.id, envVar, ok: true, detail: `Pulled ${envVar}` })
    } catch (err: any) {
      results.push({ id: integration.id, envVar, ok: false, detail: err.message || 'Failed' })
    }
  }

  // Write .env once after all pulls
  const successCount = results.filter(r => r.ok).length
  if (successCount > 0) {
    await writeEnvFile(lines)
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'integration_pull_all_1password',
    actor: user.username,
    actor_id: user.id,
    detail: {
      category: category ?? 'all',
      success: successCount,
      failed: results.length - successCount,
      results: results.map(r => ({ id: r.id, ok: r.ok })),
    },
    ip_address: ipAddress,
  })

  return NextResponse.json({
    ok: successCount > 0,
    detail: `Pulled ${successCount}/${results.length} integrations`,
    results,
  })
}
