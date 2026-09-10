import { describe, expect, it } from 'vitest'
import { clampRailWidth, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN } from '../rail-width'

describe('clampRailWidth', () => {
  it('clamps to the default range', () => {
    expect(clampRailWidth(RAIL_DEFAULT, 1400)).toBe(RAIL_DEFAULT)
    expect(clampRailWidth(80, 1400)).toBe(RAIL_MIN)
    expect(clampRailWidth(900, 1400)).toBe(RAIL_MAX)
  })

  it('leaves room for the main pane on a narrow viewport', () => {
    expect(clampRailWidth(480, 600)).toBe(240)
  })

  it('treats non-finite input as the default', () => {
    expect(clampRailWidth(Number.NaN, 1400)).toBe(RAIL_DEFAULT)
  })
})
