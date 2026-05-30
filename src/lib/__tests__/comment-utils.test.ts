import { describe, expect, it } from 'vitest'
import { countCommentsDeep } from '../comment-utils'

describe('countCommentsDeep — full comment-tree count (issue #664)', () => {
  it('returns 0 for empty / null / undefined', () => {
    expect(countCommentsDeep([])).toBe(0)
    expect(countCommentsDeep(null)).toBe(0)
    expect(countCommentsDeep(undefined)).toBe(0)
  })

  it('counts flat top-level comments', () => {
    expect(countCommentsDeep([{}, {}, {}])).toBe(3)
  })

  it('counts nested replies recursively (matches the card badge COUNT(*))', () => {
    const tree = [
      { replies: [{}, { replies: [{}] }] }, // 1 + 2 + 1 = 4
      {},                                    // 1
    ]
    expect(countCommentsDeep(tree)).toBe(5)
  })

  it('treats missing/null replies as no children', () => {
    expect(countCommentsDeep([{ replies: null }, { replies: [] }])).toBe(2)
  })

  it('handles deep nesting', () => {
    const deep = [{ replies: [{ replies: [{ replies: [{}] }] }] }]
    expect(countCommentsDeep(deep)).toBe(4)
  })
})
