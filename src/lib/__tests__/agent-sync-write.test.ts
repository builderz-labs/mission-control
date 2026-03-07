import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'

// ── temp directory – defined via vi.hoisted so CONFIG_PATH is available inside vi.mock ──
const { TMP_DIR, CONFIG_PATH } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  const TMP_DIR = path.join(os.tmpdir(), 'mc-agent-sync-write-test')
  return { TMP_DIR, CONFIG_PATH: path.join(TMP_DIR, 'openclaw.json') }
})

// ── config mock pointing to our temp file ───────────────────────────────────
vi.mock('@/lib/config', () => ({
  config: { openclawConfigPath: CONFIG_PATH },
  ensureDirExists: vi.fn(),
}))

// ── heavy deps that writeAgentToConfig doesn't need ─────────────────────────
vi.mock('better-sqlite3', () => ({ default: vi.fn(() => ({ prepare: vi.fn(), pragma: vi.fn(), exec: vi.fn(), close: vi.fn() })) }))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn(), db_helpers: {}, logAuditEvent: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/migrations', () => ({ runMigrations: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

// ── subject under test ───────────────────────────────────────────────────────
import { writeAgentToConfig } from '@/lib/agent-sync'

const EMPTY_CONFIG = JSON.stringify({ agents: { list: [] } }, null, 2)

describe('writeAgentToConfig – model written to openclaw.json', () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true })
  })

  afterAll(async () => {
    await rm(TMP_DIR, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await writeFile(CONFIG_PATH, EMPTY_CONFIG)
  })

  async function readWritten() {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'))
  }

  it('writes model.primary and model.fallbacks to openclaw.json', async () => {
    const fallbacks = ['openrouter/anthropic/claude-sonnet-4', 'moonshot/kimi-k2-thinking']
    await writeAgentToConfig({
      id: 'my-agent',
      name: 'My Agent',
      model: { primary: 'anthropic/claude-sonnet-4-20250514', fallbacks },
    })

    const written = await readWritten()
    const agent = written.agents.list[0]
    expect(agent.model.primary).toBe('anthropic/claude-sonnet-4-20250514')
    expect(agent.model.fallbacks).toEqual(fallbacks)
  })

  it('writes model with only primary when no fallbacks are provided', async () => {
    await writeAgentToConfig({ id: 'simple-agent', model: { primary: 'anthropic/claude-opus-4-5' } })

    const written = await readWritten()
    expect(written.agents.list[0].model.primary).toBe('anthropic/claude-opus-4-5')
    expect(written.agents.list[0].model.fallbacks).toBeUndefined()
  })

  it('writes agent without model field unmodified', async () => {
    await writeAgentToConfig({ id: 'no-model-agent', name: 'No Model' })

    const written = await readWritten()
    const agent = written.agents.list[0]
    expect(agent.model).toBeUndefined()
    expect(agent.name).toBe('No Model')
  })

  it('deep-merges with an existing agent entry rather than replacing it', async () => {
    await writeFile(CONFIG_PATH, JSON.stringify({
      agents: {
        list: [{
          id: 'existing-agent',
          name: 'Existing',
          model: { primary: 'anthropic/claude-haiku-4-5', fallbacks: ['openai/codex-mini-latest'] },
          tools: { allow: ['read'] },
        }],
      },
    }, null, 2))

    await writeAgentToConfig({
      id: 'existing-agent',
      model: { primary: 'anthropic/claude-sonnet-4-20250514', fallbacks: ['moonshot/kimi-k2-thinking'] },
    })

    const written = await readWritten()
    const agent = written.agents.list[0]
    expect(agent.model.primary).toBe('anthropic/claude-sonnet-4-20250514')
    expect(agent.model.fallbacks).toEqual(['moonshot/kimi-k2-thinking'])
    expect(agent.name).toBe('Existing')
    expect(agent.tools?.allow).toEqual(['read'])
  })
})
