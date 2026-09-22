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

describe('readGrokTranscript', () => {
  beforeEach(() => {
    vi.resetModules()
    tempHome = mkdtempSync(join(tmpdir(), 'mc-grok-tr-'))
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('reads user and assistant lines and skips system reminders', async () => {
    const sessionDir = join(tempHome, '.grok', 'sessions', '%2Ftmp', 'sess-g1')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'chat_history.jsonl'), [
      JSON.stringify({ type: 'system', content: 'hidden' }),
      JSON.stringify({ type: 'user', content: [{ type: 'text', text: '<system-reminder>\nnoise' }] }),
      JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'Cover the gate' }] }),
      JSON.stringify({ type: 'assistant', content: 'Collapsed rail is on.' }),
    ].join('\n'))

    const { readGrokTranscript } = await import('@/lib/grok-transcript')
    const messages = readGrokTranscript('sess-g1', 20)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user' })
    expect(messages[1]).toMatchObject({ role: 'assistant' })
  })
})
