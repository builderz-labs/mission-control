import { describe, it, expect } from 'vitest'
import { looksLikeDeliverable } from '../task-dispatch'

describe('looksLikeDeliverable', () => {
  it('rejects empty / null / whitespace', () => {
    expect(looksLikeDeliverable(null)).toBe(false)
    expect(looksLikeDeliverable('')).toBe(false)
    expect(looksLikeDeliverable('   \n  ')).toBe(false)
  })

  it('rejects the no-output fallback sentinel', () => {
    expect(looksLikeDeliverable('Deferred agent run completed without textual output.')).toBe(false)
  })

  it('rejects one-line stub acknowledgements (the bug this guards)', () => {
    expect(looksLikeDeliverable('Reviso el contexto antes de responder.')).toBe(false)
    expect(looksLikeDeliverable('Reviso si esos CSVs existen dentro del sandbox.')).toBe(false)
  })

  it('accepts artifact signals regardless of length', () => {
    expect(looksLikeDeliverable('<html><body>report</body></html>')).toBe(true)
    expect(looksLikeDeliverable('```\ncode\n```')).toBe(true)
    expect(looksLikeDeliverable('| a | b |\n| 1 | 2 |')).toBe(true)
    expect(looksLikeDeliverable('Fuente: https://example.com/data')).toBe(true)
  })

  it('accepts substantial prose', () => {
    expect(looksLikeDeliverable('x'.repeat(120))).toBe(true)
  })

  it('rejects short prose with no artifact signal', () => {
    expect(looksLikeDeliverable('Listo, ya quedó.')).toBe(false)
  })
})
