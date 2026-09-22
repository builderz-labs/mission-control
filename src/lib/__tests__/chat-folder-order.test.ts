import { describe, expect, it } from 'vitest'
import {
  applyFolderOrder,
  mergeFolderOrder,
  moveFolder,
  parseFolderOrder,
} from '../chat-folder-order'

describe('parseFolderOrder', () => {
  it('reads a unique string array', () => {
    expect(parseFolderOrder('["folder:b","folder:a","folder:b"]')).toEqual([
      'folder:b',
      'folder:a',
    ])
  })

  it('returns empty for missing or invalid payloads', () => {
    expect(parseFolderOrder(null)).toEqual([])
    expect(parseFolderOrder('')).toEqual([])
    expect(parseFolderOrder('nope')).toEqual([])
    expect(parseFolderOrder('[1, "a"]')).toEqual(['a'])
  })
})

describe('mergeFolderOrder', () => {
  it('keeps known order and appends new keys in given order', () => {
    expect(mergeFolderOrder(['c', 'a', 'gone'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
  })
})

describe('moveFolder', () => {
  it('moves a key to the target index', () => {
    expect(moveFolder(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(moveFolder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op when either key is missing', () => {
    expect(moveFolder(['a', 'b'], 'a', 'z')).toEqual(['a', 'b'])
    expect(moveFolder(['a', 'b'], 'z', 'a')).toEqual(['a', 'b'])
  })
})

describe('applyFolderOrder', () => {
  it('puts ordered keys first and keeps remaining original order', () => {
    const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
    expect(applyFolderOrder(rows, ['c', 'a', 'missing']).map((row) => row.key)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('returns original order when the persisted list is empty', () => {
    const rows = [{ key: 'a' }, { key: 'b' }]
    expect(applyFolderOrder(rows, [])).toEqual(rows)
  })
})
