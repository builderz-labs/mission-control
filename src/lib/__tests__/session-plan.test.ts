import { describe, expect, it } from 'vitest'
import { extractPlanMarkdown } from '../session-plan'

describe('extractPlanMarkdown', () => {
  it('returns the latest assistant plan', () => {
    const plan = extractPlanMarkdown([
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: '# Franchise-Readiness Execution Plan\n\nWhen you say go I will start the wave in this order without asking again, and I will keep going until the register is repaired.' }],
      },
    ])
    expect(plan).toContain('Franchise-Readiness')
  })

  it('returns null when there is no plan', () => {
    expect(extractPlanMarkdown([
      { role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] },
    ])).toBeNull()
  })
})
