import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllModels } from '../models'

const state = vi.hoisted(() => ({
  dispatchModel: '',
  run: vi.fn<(...args: unknown[]) => { changes: number }>(() => ({ changes: 1 })),
}))

vi.mock('../db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      all: () => sql.includes('JOIN agents') ? [{
        id: 1, title: 'Summarize the task', description: 'Keep the supplied text.',
        status: 'assigned', priority: 'medium', assigned_to: 'test-agent',
        workspace_id: 1, agent_name: 'test-agent', agent_id: 1,
        agent_config: JSON.stringify({ dispatchModel: state.dispatchModel }),
      }] : [],
      get: () => sql.includes('soul_content') ? { soul_content: 'Test system prompt' } : undefined,
      run: state.run,
    }),
  }),
  db_helpers: { logActivity: vi.fn() },
}))
vi.mock('../config', () => ({ config: {} }))
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('../github-sync-engine', () => ({ syncTaskOutbound: vi.fn() }))
vi.mock('../openclaw-gateway', () => ({ callOpenClawGateway: vi.fn() }))
vi.mock('../command', () => ({ runOpenClaw: vi.fn() }))
vi.mock('../sessions', () => ({ getAllGatewaySessions: vi.fn(() => []) }))

import { dispatchAssignedTasks } from '../task-dispatch'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv('MINIMAX_API_KEY', 'test-minimax-key')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('LOCAL_LLM_ENDPOINT', '')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'Completed task' } }],
      content: [{ type: 'thinking', thinking: 'Internal reasoning' }, { type: 'text', text: 'Completed task' }],
    }),
  })
  state.run.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe.each(['global_en', 'cn_zh'])('MiniMax task dispatch in %s', (region) => {
  describe.each(['openai', 'anthropic'])('%s protocol', (protocol) => {
    it.each([
      ['first catalog choice', '', 'MiniMax-M3.1-Flash'],
      ['explicit Flash ID', 'MiniMax-M3.1-Flash', 'MiniMax-M3.1-Flash'],
      ['saved M3 alias', 'minimax', 'MiniMax-M3'],
      ['saved M3 ID', 'minimax/MiniMax-M3', 'MiniMax-M3'],
      ['legacy alias', 'minimax-m2.7', 'MiniMax-M2.7'],
      ['legacy ID', 'MiniMax-M2.1', 'MiniMax-M2.1'],
      ['custom ID', 'minimax/custom-model', 'custom-model'],
    ])('serializes %s at the real HTTP boundary', async (_label, selected, expected) => {
      vi.stubEnv('MINIMAX_REGION', region)
      vi.stubEnv('MINIMAX_API_PROTOCOL', protocol)
      state.dispatchModel = selected || getAllModels().find(m => m.provider === 'minimax')!.alias
      const result = await dispatchAssignedTasks()
      expect(result.message).toContain('1/1')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      const host = region === 'global_en' ? 'api.minimax.io' : 'api.minimaxi.com'
      expect(url).toBe(`https://${host}${protocol === 'openai' ? '/v1/chat/completions' : '/anthropic/v1/messages'}`)
      expect(init.headers.Authorization).toBe('Bearer test-minimax-key')
      const body = JSON.parse(init.body)
      expect(body.model).toBe(expected)
      expect(body.max_tokens).toBe(4096)
      expect(body.messages.at(-1)).toEqual({ role: 'user', content: expect.stringContaining('Keep the supplied text.') })
      if (protocol === 'openai') {
        expect(body.messages[0]).toEqual({ role: 'system', content: 'Test system prompt' })
      } else {
        expect(body.system).toBe('Test system prompt')
      }
      // No thinking/effort controls exist in task dispatch: retain API defaults
      // (Flash adaptive/max; M3 adaptive on OpenAI, disabled on Anthropic).
      for (const key of ['thinking', 'reasoning_effort', 'output_config', 'service_tier', 'reasoning_split']) {
        expect(body).not.toHaveProperty(key)
      }
      expect(state.run.mock.calls.some(args => args.includes('Completed task'))).toBe(true)
    })
  })
})

it('reports a MiniMax HTTP error without retrying another provider', async () => {
  vi.stubEnv('MINIMAX_REGION', 'global_en')
  vi.stubEnv('MINIMAX_API_PROTOCOL', 'openai')
  state.dispatchModel = 'minimax-m3.1-flash'
  fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'Invalid request' })
  const result = await dispatchAssignedTasks()
  expect(result.message).toContain('0/1')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
