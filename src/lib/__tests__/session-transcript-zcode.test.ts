import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __testables } from '@/lib/session-transcript-route'

const { readZcodeTranscript } = __testables

const KNOWN = 'sess_44444444-4444-4444-8444-444444444444'
const SHAPED = 'sess_55555555-5555-5555-8555-555555555555'
const OPAQUE = 'sess_66666666-6666-6666-8666-666666666666'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-zcode-transcript-'))
  process.env.ZCODE_ROLLOUT_DIR = dir

  writeFileSync(join(dir, `model-io-${SHAPED}.jsonl`), [
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'plan the adapter' }, timestamp: '2026-10-02T10:00:00.000Z' }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } }),
  ].join('\n'), 'utf8')

  // Upstream record shapes MC does not recognize must yield no messages rather
  // than invented transcript content.
  writeFileSync(join(dir, `model-io-${OPAQUE}.jsonl`), [
    JSON.stringify({ kind: 'internal', payload: { opaque: true } }),
    'garbage',
  ].join('\n'), 'utf8')
})

afterAll(() => {
  delete process.env.ZCODE_ROLLOUT_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('readZcodeTranscript', () => {
  it('normalizes recognized message records', () => {
    const messages = readZcodeTranscript(SHAPED, 40)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: 'plan the adapter' })
  })

  it('returns nothing for unrecognized record shapes', () => {
    expect(readZcodeTranscript(OPAQUE, 40)).toEqual([])
  })

  it('returns nothing for a missing rollout or an unsafe session id', () => {
    expect(readZcodeTranscript(KNOWN, 40)).toEqual([])
    expect(readZcodeTranscript('../../etc/passwd', 40)).toEqual([])
  })
})
