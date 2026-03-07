import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── fs/promises mock ────────────────────────────────────────────────────────
const { mockReadFile, mockWriteFile } = vi.hoisted(() => {
  const mockReadFile = vi.fn()
  const mockWriteFile = vi.fn()
  return { mockReadFile, mockWriteFile }
})

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}))

// ── config mock ─────────────────────────────────────────────────────────────
vi.mock('@/lib/config', () => ({
  config: { openclawConfigPath: '/fake/openclaw.json' },
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

const EMPTY_CONFIG = JSON.stringify({ agents: { list: [] } })

describe('writeAgentToConfig – model.fallbacks sanitization', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(EMPTY_CONFIG)
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('strips model.fallbacks before writing to openclaw.json', async () => {
    await writeAgentToConfig({
      id: 'my-agent',
      name: 'My Agent',
      model: {
        primary: 'anthropic/claude-sonnet-4-20250514',
        fallbacks: ['openrouter/anthropic/claude-sonnet-4', 'moonshot/kimi-k2-thinking'],
      },
    })

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [, writtenContent] = mockWriteFile.mock.calls[0]
    const written = JSON.parse(writtenContent)
    const agent = written.agents.list[0]

    // primary must be preserved
    expect(agent.model.primary).toBe('anthropic/claude-sonnet-4-20250514')
    // fallbacks must NOT be written (OpenClaw rejects unknown model properties)
    expect(agent.model.fallbacks).toBeUndefined()
  })

  it('preserves model.primary when model has no fallbacks', async () => {
    await writeAgentToConfig({
      id: 'simple-agent',
      model: { primary: 'anthropic/claude-opus-4-5' },
    })

    const written = JSON.parse(mockWriteFile.mock.calls[0][1])
    expect(written.agents.list[0].model.primary).toBe('anthropic/claude-opus-4-5')
    expect(written.agents.list[0].model.fallbacks).toBeUndefined()
  })

  it('does not mutate agentConfig argument', async () => {
    const agentConfig = {
      id: 'agent-x',
      model: {
        primary: 'anthropic/claude-haiku-latest',
        fallbacks: ['openai/gpt-4o-mini'],
      },
    }
    const originalFallbacks = agentConfig.model.fallbacks

    await writeAgentToConfig(agentConfig)

    // The caller's object must not have been modified
    expect(agentConfig.model.fallbacks).toBe(originalFallbacks)
  })

  it('writes agent without model field unmodified', async () => {
    await writeAgentToConfig({ id: 'no-model-agent', name: 'No Model' })

    const written = JSON.parse(mockWriteFile.mock.calls[0][1])
    const agent = written.agents.list[0]
    expect(agent.model).toBeUndefined()
    expect(agent.name).toBe('No Model')
  })
})
