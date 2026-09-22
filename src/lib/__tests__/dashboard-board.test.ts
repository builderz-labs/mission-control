import { describe, expect, it } from 'vitest'
import {
  compactUp,
  firstFit,
  migrateLegacyLayout,
  moveItem,
  packItem,
  parseTileId,
  pinItem,
  removeItem,
  resizeItem,
  sessionTileId,
  syncLiveSessions,
  widgetTileId,
  type BoardState,
} from '@/lib/dashboard-board'

function board(items: BoardState['items']): BoardState {
  return { version: 1, cols: 12, items }
}

describe('dashboard-board', () => {
  it('migrates a legacy id list onto a 12-col grid', () => {
    const next = migrateLegacyLayout(['briefing-bar', 'fleet-status', 'activity-timeline'], (id) => (
      id === 'briefing-bar' ? 'full' : 'md'
    ))
    expect(next.items[0]).toMatchObject({ id: widgetTileId('briefing-bar'), w: 12, y: 0 })
    expect(next.items.map((item) => item.id)).toEqual([
      widgetTileId('briefing-bar'),
      widgetTileId('fleet-status'),
      widgetTileId('activity-timeline'),
    ])
    expect(parseTileId(widgetTileId('fleet-status'))).toEqual({ kind: 'widget', ref: 'fleet-status' })
  })

  it('packs a session into the first free hole', () => {
    const seeded = migrateLegacyLayout(['briefing-bar'], () => 'full')
    const packed = packItem(seeded, {
      id: sessionTileId('abc'),
      kind: 'session',
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    })
    expect(packed.items.at(-1)).toMatchObject({ id: sessionTileId('abc'), x: 0, y: 1, w: 4, h: 2 })
  })

  it('does not duplicate an existing tile when packing', () => {
    const seeded = packItem(board([]), {
      id: sessionTileId('abc'),
      kind: 'session',
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    })
    expect(packItem(seeded, seeded.items[0]!).items).toHaveLength(1)
  })

  it('moves a tile and pushes collisions down', () => {
    const start = board([
      { id: widgetTileId('a'), kind: 'widget', x: 0, y: 0, w: 6, h: 2 },
      { id: widgetTileId('b'), kind: 'widget', x: 6, y: 0, w: 6, h: 2 },
    ])
    const moved = moveItem(start, widgetTileId('a'), 6, 0)
    const a = moved.items.find((item) => item.id === widgetTileId('a'))
    const b = moved.items.find((item) => item.id === widgetTileId('b'))
    expect(a?.x).toBe(6)
    expect(b && a && (b.y >= a.y + a.h || b.x + b.w <= a.x)).toBe(true)
  })

  it('resizes onto an allowed width', () => {
    const start = board([{ id: widgetTileId('a'), kind: 'widget', x: 0, y: 0, w: 4, h: 2 }])
    const resized = resizeItem(start, widgetTileId('a'), 7, 3)
    expect(resized.items[0]).toMatchObject({ w: 6, h: 3 })
  })

  it('adds live sessions and drops ended unpinned ones', () => {
    const withLive = syncLiveSessions(board([]), ['s1', 's2'])
    expect(withLive.items.map((item) => item.id)).toEqual([
      sessionTileId('s1'),
      sessionTileId('s2'),
    ])
    const pinned = pinItem(withLive, sessionTileId('s1'), true)
    const after = syncLiveSessions(pinned, [])
    expect(after.items.map((item) => item.id)).toEqual([sessionTileId('s1')])
    expect(after.items[0]?.pinned).toBe(true)
  })

  it('compacts tiles upward after a removal', () => {
    const start = board([
      { id: widgetTileId('a'), kind: 'widget', x: 0, y: 0, w: 12, h: 1 },
      { id: widgetTileId('b'), kind: 'widget', x: 0, y: 2, w: 12, h: 1 },
    ])
    const next = compactUp(removeItem(start, widgetTileId('a')))
    expect(next.items[0]).toMatchObject({ id: widgetTileId('b'), y: 0 })
  })

  it('finds the first free cell', () => {
    expect(firstFit([], 4, 2)).toEqual({ x: 0, y: 0 })
    const filled = board([{ id: 'w', kind: 'widget', x: 0, y: 0, w: 12, h: 1 }])
    expect(firstFit(filled.items, 4, 2)).toEqual({ x: 0, y: 1 })
  })
})
