import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempHome = ''

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return tempHome
    },
  },
}))

describe('readKimiTranscript', () => {
  beforeEach(() => {
    vi.resetModules()
    tempHome = mkdtempSync(join(tmpdir(), 'mc-kimi-tr-'))
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('maps turn.prompt and content.part text', async () => {
    const sessionDir = join(tempHome, '.kimi-code', 'sessions', 'wd_dev', 'session_k1')
    mkdirSync(join(sessionDir, 'agents', 'main'), { recursive: true })
    mkdirSync(join(tempHome, '.kimi-code'), { recursive: true })
    writeFileSync(join(tempHome, '.kimi-code', 'session_index.jsonl'), `${JSON.stringify({
      sessionId: 'session_k1',
      sessionDir,
      workDir: '/Users/dev/actz-may',
    })}\n`)
    writeFileSync(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [
      JSON.stringify({ type: 'turn.prompt', origin: { kind: 'user' }, input: [{ type: 'text', text: 'Fix the layout' }], time: Date.now() }),
      JSON.stringify({
        type: 'context.append_loop_event',
        event: { type: 'content.part', part: { type: 'text', text: 'I will audit the pages.' } },
        time: Date.now(),
      }),
    ].join('\n'))

    const { readKimiTranscript } = await import('@/lib/kimi-transcript')
    const messages = readKimiTranscript('session_k1', 20)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})
