import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_FILTERS,
  buildSidebarRows,
  filterSessions,
  type ChatProjectItem,
  type ChatSessionItem,
} from '../group-sessions'

function session(partial: Partial<ChatSessionItem> & Pick<ChatSessionItem, 'id'>): ChatSessionItem {
  return {
    name: partial.name || partial.id,
    active: false,
    updatedAt: 100,
    workingDir: '/Users/tylerdevries/Dev/actz-may',
    agent: 'claude',
    environment: 'local',
    project: 'actz-may',
    projectSlug: 'actz-may',
    hasPr: false,
    kind: 'claude-code',
    ...partial,
  }
}

const projects: ChatProjectItem[] = [
  { name: 'actz-may', slug: 'actz-may' },
  { name: 'stillpoint-builders', slug: 'stillpoint-builders' },
]

describe('filterSessions', () => {
  const rows = [
    session({ id: 'a', active: true, name: 'gate tests' }),
    session({ id: 'b', active: false, name: 'idle work', environment: 'gateway' }),
  ]

  it('keeps every session by default status', () => {
    const visible = filterSessions(rows, DEFAULT_CHAT_FILTERS)
    expect(visible.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('filters to active when requested', () => {
    const visible = filterSessions(rows, { ...DEFAULT_CHAT_FILTERS, status: 'active' })
    expect(visible.map((s) => s.id)).toEqual(['a'])
  })

  it('filters by environment and search', () => {
    const visible = filterSessions(rows, {
      ...DEFAULT_CHAT_FILTERS,
      status: 'all',
      environment: 'gateway',
      search: 'idle',
    })
    expect(visible.map((s) => s.id)).toEqual(['b'])
  })
})

describe('buildSidebarRows', () => {
  const sessions = [
    session({
      id: '1',
      active: true,
      updatedAt: 300,
      workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
      project: 'stillpoint-builders',
      projectSlug: 'stillpoint-builders',
      hasPr: true,
    }),
    session({
      id: '2',
      active: true,
      updatedAt: 200,
      name: 'auth fix',
    }),
  ]

  it('groups by folder and sorts by activity', () => {
    const { rest } = buildSidebarRows(sessions, projects, DEFAULT_CHAT_FILTERS, [])
    expect(rest.map((r) => r.label)).toEqual(['stillpoint-builders', 'actz-may'])
    expect(rest[0].hasPr).toBe(true)
  })

  it('keeps activity order even when a folder order is persisted', () => {
    const { rest } = buildSidebarRows(
      sessions,
      projects,
      DEFAULT_CHAT_FILTERS,
      [],
      ['folder:actz-may', 'folder:stillpoint-builders'],
    )
    expect(rest.map((r) => r.label)).toEqual(['stillpoint-builders', 'actz-may'])
  })

  it('uses persisted folder order when sorting by name', () => {
    const { rest } = buildSidebarRows(
      sessions,
      projects,
      { ...DEFAULT_CHAT_FILTERS, sortBy: 'name' },
      [],
      ['folder:stillpoint-builders', 'folder:actz-may'],
    )
    expect(rest.map((r) => r.label)).toEqual(['stillpoint-builders', 'actz-may'])
  })

  it('puts pinned rows first', () => {
    const { pinned, rest } = buildSidebarRows(
      sessions,
      projects,
      DEFAULT_CHAT_FILTERS,
      ['actz-may'],
    )
    expect(pinned.map((r) => r.label)).toEqual(['actz-may'])
    expect(rest.map((r) => r.label)).toEqual(['stillpoint-builders'])
  })

  it('includes catalog projects that have no sessions', () => {
    const { rest } = buildSidebarRows([sessions[0]], projects, DEFAULT_CHAT_FILTERS, [])
    expect(rest.some((row) => row.label === 'actz-may' && row.sessionCount === 0)).toBe(true)
  })

  it('groups by agent', () => {
    const { rest } = buildSidebarRows(
      sessions,
      projects,
      { ...DEFAULT_CHAT_FILTERS, groupBy: 'agent' },
      [],
    )
    expect(rest).toEqual([
      expect.objectContaining({ key: 'agent:claude', sessionCount: 2 }),
    ])
  })
})
