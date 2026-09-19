import { describe, expect, it } from 'vitest'
import { transcriptFingerprint } from '../transcript-fingerprint'

describe('transcriptFingerprint', () => {
  it('changes when last text changes even if length stays the same', () => {
    const first = transcriptFingerprint([
      { timestamp: 't1', parts: [{ type: 'text', text: 'hello world' }] },
    ])
    const second = transcriptFingerprint([
      { timestamp: 't1', parts: [{ type: 'text', text: 'hello there' }] },
    ])
    expect(first).not.toBe(second)
  })

  it('is stable for identical messages', () => {
    const messages = [{ timestamp: 't1', parts: [{ type: 'text', text: 'same' }] }]
    expect(transcriptFingerprint(messages)).toBe(transcriptFingerprint(messages))
  })
})
