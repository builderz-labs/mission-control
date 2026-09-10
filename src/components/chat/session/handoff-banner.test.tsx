import { describe, expect, it } from 'vitest'
import { transcriptExcerpt } from './handoff-banner'

describe('transcriptExcerpt', () => {
  it('joins text parts newest-last and caps length', () => {
    const excerpt = transcriptExcerpt([
      { role: 'user', parts: [{ type: 'text', text: 'alpha' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'bravo' }, { type: 'thinking', thinking: 'skip' }] },
    ], 4000)
    expect(excerpt).toBe('alpha\nbravo')
  })

  it('keeps the tail when over cap', () => {
    const excerpt = transcriptExcerpt([
      { role: 'user', parts: [{ type: 'text', text: 'x'.repeat(50) }] },
    ], 10)
    expect(excerpt).toHaveLength(10)
  })
})
