import type { DashboardSession } from './dashboard-cli-fleets'
import { orderTerminalSessions } from './terminal-sessions'

/**
 * Column snaps, mirroring the fixed choices in VS Code's Editor Layout menu.
 * A terminal stops being readable below roughly 260px of width, so `auto` never
 * picks more than three columns however many sessions are live; an operator who
 * wants a denser wall can still snap to four.
 */
export const TERMINAL_GRID_SNAPS = [1, 2, 3, 4] as const
export type TerminalGridSnap = (typeof TERMINAL_GRID_SNAPS)[number]
export type TerminalGridDensity = 'auto' | TerminalGridSnap

/** Cells past this point are noise on a dashboard; the sessions panel owns the long tail. */
export const TERMINAL_GRID_LIMIT = 12

export function terminalGridColumns(count: number, density: TerminalGridDensity): TerminalGridSnap {
  if (density !== 'auto') return density
  if (count <= 1) return 1
  if (count <= 4) return 2
  return 3
}

/** Tailwind needs whole class names, so the spans are spelled out rather than built. */
const COLUMN_CLASS: Record<TerminalGridSnap, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
}

export function terminalGridClass(columns: TerminalGridSnap): string {
  return COLUMN_CLASS[columns]
}

/**
 * The grid shows what is running now. Idle sessions stay reachable from the
 * sessions panel rather than competing for space with live work; when nothing
 * is running at all we fall back to the most recent sessions so the panel is
 * never a dead rectangle.
 */
export function gridTerminalSessions(
  sessions: DashboardSession[],
  limit = TERMINAL_GRID_LIMIT,
): DashboardSession[] {
  const active = sessions.filter((session) => session.active)
  return orderTerminalSessions(active.length > 0 ? active : sessions, limit)
}
