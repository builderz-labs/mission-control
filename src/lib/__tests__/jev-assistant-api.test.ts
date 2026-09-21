// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateJevApiDraft } from '@/lib/jev-assistant-api'
import { JEV_API_DRAFT_SCHEMA, parseJevApiDraft } from '@/lib/jev-assistant-api-schema'
import { jevAssistantModel, jevAssistantOptions, resolveJevAssistantProvider } from '@/lib/jev-assistant-config'
import { jevAssistantErrorMessage } from '@/lib/jev-assistant-error'

const draft = {
  summary: 'Classify support messages', name: 'Support', description: 'Review requests',
  questions: [{ id: 'urgent', type: 'noul', instructions: 'Does the message request urgent action?', positive: '', negative: '', options: [], levels: [] }],
  tests: ['Ambiguous evidence'], risks: ['Missing context'], observability: ['Latency'], warnings: [], clarifications: [],
}
const ok = (kind: 'anthropic' | 'openai') => Response.json(kind === 'anthropic'
  ? { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }] }
  : { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }] })
const request = vi.fn()
beforeEach(() => {
  request.mockReset(); vi.stubGlobal('fetch', request)
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic'); vi.stubEnv('OPENAI_API_KEY', 'test-openai')
  vi.stubEnv('JEV_ASSISTANT_PROVIDER', ''); vi.stubEnv('JEV_OPENAI_MODEL', ''); vi.stubEnv('JEV_ANTHROPIC_MODEL', '')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('Jev API setup providers', () => {
  it.each(['anthropic', 'openai'] as const)('uses the fixed %s endpoint and validates typed questions', async (kind) => {
    request.mockResolvedValue(ok(kind))
    const result = await generateJevApiDraft(kind, 'redacted input')
    expect(result.questions.urgent.type).toBe('noul')
    const [url, options] = request.mock.calls[0]
    expect(url).toBe(kind === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses')
    expect(options.redirect).toBe('error'); expect(options.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(options.body)
    expect(body.tools).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('test-anthropic')
    expect(JSON.stringify(body)).not.toContain('test-openai')
    if (kind === 'openai') { expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true) }
    else expect(body.output_config.format.schema).toEqual(JEV_API_DRAFT_SCHEMA)
  })
  it('retries a transient failure exactly once without switching providers', async () => {
    request.mockResolvedValueOnce(new Response('private provider error', { status: 503 })).mockResolvedValueOnce(ok('openai'))
    await expect(generateJevApiDraft('openai', 'safe')).resolves.toHaveProperty('questions.urgent')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([url]) => url === 'https://api.openai.com/v1/responses')).toBe(true)
  })
  it('does not expose or retry authentication failures', async () => {
    request.mockResolvedValue(new Response('secret-provider-diagnostic', { status: 401 }))
    await expect(generateJevApiDraft('anthropic', 'safe')).rejects.toMatchObject({ code: 'JEV_ASSISTANT_AUTH' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(jevAssistantErrorMessage('JEV_ASSISTANT_AUTH')).toContain('Doppler')
    expect(jevAssistantErrorMessage('secret-provider-diagnostic')).not.toContain('secret-provider-diagnostic')
  })
  it('handles refusal and incomplete answers without inventing a draft', async () => {
    request.mockResolvedValueOnce(Response.json({ stop_reason: 'refusal', content: [] }))
      .mockResolvedValueOnce(Response.json({ status: 'incomplete', output: [] }))
    await expect(generateJevApiDraft('anthropic', 'safe')).rejects.toMatchObject({ code: 'JEV_ASSISTANT_REFUSED' })
    await expect(generateJevApiDraft('openai', 'safe')).rejects.toMatchObject({ code: 'JEV_ASSISTANT_INVALID_OUTPUT' })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('requires the selected key and honors cancellation before sending', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    await expect(generateJevApiDraft('openai', 'safe')).rejects.toMatchObject({ code: 'JEV_ASSISTANT_UNAVAILABLE' })
    const controller = new AbortController(); controller.abort()
    await expect(generateJevApiDraft('anthropic', 'safe', controller.signal)).rejects.toMatchObject({ code: 'JEV_ASSISTANT_CANCELLED' })
    expect(request).not.toHaveBeenCalled()
  })
  it('aborts body reads at the deadline and bounds retries', async () => {
    vi.useFakeTimers()
    const clock = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal
    })
    request.mockImplementation((_url, options) => Promise.resolve(new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }) },
    }))))
    const pending = expect(generateJevApiDraft('openai', 'safe')).rejects.toMatchObject({ code: 'JEV_ASSISTANT_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(120_600)
    await pending
    expect(request).toHaveBeenCalledTimes(2)
    clock.mockRestore()
  })
  it('rejects oversized response bodies', async () => {
    request.mockResolvedValue(new Response('x'.repeat(1_000_001)))
    await expect(generateJevApiDraft('openai', 'safe')).rejects.toMatchObject({ code: 'JEV_ASSISTANT_OUTPUT_LIMIT' })
  })
})

describe('Jev structured output and provider configuration', () => {
  it('converts all question types and rejects duplicate or reserved identifiers', () => {
    const choice = { ...draft.questions[0], id: 'category', type: 'choice', options: [{ id: 'bug', description: 'Bug report' }, { id: 'other', description: 'Anything else' }] }
    const score = { ...draft.questions[0], id: 'severity', type: 'score', levels: ['Low', 'High'] }
    expect(parseJevApiDraft({ ...draft, questions: [draft.questions[0], choice, score] }).questions).toMatchObject({
      category: { criteria: { bug: 'Bug report', other: 'Anything else' } }, severity: { criteria: ['Low', 'High'] },
    })
    expect(() => parseJevApiDraft({ ...draft, questions: [draft.questions[0], draft.questions[0]] })).toThrow()
    expect(() => parseJevApiDraft({ ...draft, questions: [{ ...choice, options: [choice.options[0], choice.options[0]] }] })).toThrow()
    expect(() => parseJevApiDraft({ ...draft, questions: [{ ...score, id: 'constructor' }] })).toThrow()
    expect(() => parseJevApiDraft({ ...draft, questions: [{ ...score, levels: ['Only one'] }] })).toThrow()
    expect(() => parseJevApiDraft({ ...draft, questions: [{ ...choice, positive: 'Conflicting criteria' }] })).toThrow()
  })
  it('uses only closed objects with every property required in the API schema', () => {
    const check = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      const node = value as Record<string, unknown>
      if (node.type === 'object') { expect(node.additionalProperties).toBe(false); expect(node.required).toEqual(Object.keys(node.properties as object)) }
      Object.values(node).forEach(check)
    }
    check(JEV_API_DRAFT_SCHEMA)
  })
  it('keeps Claude Code default even when optional API keys exist', () => {
    expect(resolveJevAssistantProvider()).toBe('claude-cli')
    expect(resolveJevAssistantProvider('openai')).toBe('openai')
    vi.stubEnv('JEV_ASSISTANT_PROVIDER', 'anthropic')
    expect(resolveJevAssistantProvider()).toBe('anthropic')
    vi.stubEnv('JEV_OPENAI_MODEL', '--unsafe-model')
    expect(jevAssistantModel('openai')).toBe('gpt-4.1-mini')
    expect(jevAssistantOptions(false).map((option) => option.configured)).toEqual([true, true, false])
    expect(JSON.stringify(jevAssistantOptions(true))).not.toContain('test-anthropic')
  })
})
