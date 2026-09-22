import { describe, expect, it } from 'vitest'
import {
  BOARD_STORAGE_KEY,
  LEGACY_LAYOUT_KEY,
  MAX_BOARD_BYTES,
  parseBoardJson,
  readLocalBoard,
  serializeBoard,
  writeLocalBoard,
} from '@/lib/dashboard-board-persist'
import { emptyBoard, widgetTileId } from '@/lib/dashboard-board'

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    map,
  }
}

describe('dashboard-board-persist', () => {
  it('round-trips a board through JSON', () => {
    const board = emptyBoard()
    board.items.push({ id: widgetTileId('fleet-status'), kind: 'widget', x: 0, y: 0, w: 4, h: 2 })
    expect(parseBoardJson(serializeBoard(board))?.items).toEqual(board.items)
  })

  it('rejects oversized payloads', () => {
    expect(parseBoardJson('{"version":1,"items":[]} '.repeat(8000))).toBeNull()
    const huge = emptyBoard()
    huge.items = Array.from({ length: 400 }, (_, i) => ({
      id: `widget:${'x'.repeat(80)}${i}`,
      kind: 'widget' as const,
      x: 0,
      y: i,
      w: 4,
      h: 1,
    }))
    expect(() => serializeBoard(huge)).toThrow(/32KB/)
    expect(new TextEncoder().encode(JSON.stringify(huge)).length).toBeGreaterThan(MAX_BOARD_BYTES)
  })

  it('migrates legacy localStorage layouts', () => {
    const storage = memoryStorage({
      [LEGACY_LAYOUT_KEY]: JSON.stringify(['briefing-bar', 'fleet-status']),
    })
    const board = readLocalBoard(storage, (id) => id === 'briefing-bar' ? 'full' : 'md')
    expect(board?.items.map((item) => item.id)).toEqual([
      widgetTileId('briefing-bar'),
      widgetTileId('fleet-status'),
    ])
  })

  it('writes the modern key', () => {
    const storage = memoryStorage()
    const board = emptyBoard()
    writeLocalBoard(storage, board)
    expect(storage.map.get(BOARD_STORAGE_KEY)).toBe(serializeBoard(board))
  })
})
