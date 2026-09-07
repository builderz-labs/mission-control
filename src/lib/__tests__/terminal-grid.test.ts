import { describe, expect, it } from 'vitest'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import {
  TERMINAL_GRID_LIMIT,
  gridTerminalSessions,
  terminalGridClass,
  terminalGridColumns,
} from '@/lib/terminal-grid'

function session(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return { id, kind: 'claude-code', ...over }
}

describe('terminalGridColumns', () => {
  it('keeps a lone terminal full width and pairs a handful', () => {
    expect(terminalGridColumns(1, 'auto')).toBe(1)
    expect(terminalGridColumns(4, 'auto')).toBe(2)
  })

  it('stops widening past three columns so cells stay readable', () => {
    expect(terminalGridColumns(5, 'auto')).toBe(3)
    expect(terminalGridColumns(40, 'auto')).toBe(3)
  })

  it('honours an explicit snap over the automatic choice', () => {
    expect(terminalGridColumns(1, 4)).toBe(4)
    expect(terminalGridColumns(12, 1)).toBe(1)
  })
})

describe('terminalGridClass', () => {
  it('emits whole Tailwind class names for every snap', () => {
    expect(terminalGridClass(1)).toBe('grid-cols-1')
    expect(terminalGridClass(2)).toContain('md:grid-cols-2')
    expect(terminalGridClass(3)).toContain('xl:grid-cols-3')
    expect(terminalGridClass(4)).toContain('xl:grid-cols-4')
  })
})

describe('gridTerminalSessions', () => {
  it('shows only live sessions when anything is running', () => {
    const picked = gridTerminalSessions([
      session('idle', { lastActivity: 500 }),
      session('live', { active: true, lastActivity: 1 }),
    ])
    expect(picked.map((s) => s.id)).toEqual(['live'])
  })

  it('falls back to the most recent sessions when nothing is running', () => {
    const picked = gridTerminalSessions([
      session('old', { lastActivity: 1 }),
      session('recent', { lastActivity: 500 }),
    ])
    expect(picked.map((s) => s.id)).toEqual(['recent', 'old'])
  })

  it('caps the wall so a busy host does not render hundreds of terminals', () => {
    const many = Array.from({ length: 40 }, (_, i) => session(`s${i}`, { active: true }))
    expect(gridTerminalSessions(many)).toHaveLength(TERMINAL_GRID_LIMIT)
  })
})
