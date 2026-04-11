import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempHome = ''
let dbRowsByName: Record<string, Record<string, any[]>> = {}

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return tempHome
    },
  },
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn((dbPath?: string) => ({
    prepare: (query: string) => ({
      get: (...args: any[]) => {
        const name = dbPath ? String(dbPath).split('/').pop() || '' : ''
        const rows = dbRowsByName[name] || dbRowsByName.default || {}
        if (query.includes('sqlite_master') && args[0] === 'session') return { name: 'session' }
        if (query.includes('sqlite_master') && args[0] === 'project') return { name: 'project' }
        if (query.includes('sqlite_master') && args[0] === 'message') return { name: 'message' }
        if (query.includes('SELECT id, worktree FROM project')) {
          const project = rows.project || []
          return project.find((row: any) => row.id === args[0]) || { id: args[0], worktree: '/tmp/opencode-project' }
        }
        return undefined
      },
      all: (...args: any[]) => {
        const name = dbPath ? String(dbPath).split('/').pop() || '' : ''
        const rows = dbRowsByName[name] || dbRowsByName.default || {}
        if (query.includes('PRAGMA table_info(session)')) {
          const sample = rows.session?.[0] || {}
          return Object.keys(sample).map((key, index) => ({ cid: index, name: key }))
        }
        if (query.includes('FROM session')) return rows.session || []
        if (query.includes('FROM message')) return rows.message || []
        return []
      },
    }),
    close: vi.fn(),
  })),
}))

describe('scanOpenCodeSessions', () => {
  beforeEach(() => {
    vi.resetModules()
    tempHome = mkdtempSync(join(tmpdir(), 'mc-opencode-test-'))
    mkdirSync(join(tempHome, '.local', 'share', 'opencode'), { recursive: true })
    writeFileSync(join(tempHome, '.local', 'share', 'opencode', 'opencode-local.db'), '')
    dbRowsByName = {
      'opencode-local.db': {
        session: [
          {
            id: 'ses_open_1',
            project_id: 'proj_1',
            parent_id: null,
            slug: 'hidden-wolf',
            directory: '/tmp/opencode-project',
            title: 'OpenCode inspection',
            version: '1.4.3',
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() - 10000,
            time_updated: Date.now() - 1000,
            time_compacting: null,
            time_archived: null,
            workspace_id: null,
          },
        ],
        project: [
          {
            id: 'proj_1',
            worktree: '/tmp/opencode-project',
          },
        ],
        message: [
          {
            data: JSON.stringify({ role: 'user', model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }, tokens: { input: 11, output: 0 } }),
            time_created: Date.now() - 10000,
            time_updated: Date.now() - 10000,
          },
          {
            data: JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-sonnet-4-5', tokens: { input: 0, output: 7 } }),
            time_created: Date.now() - 5000,
            time_updated: Date.now() - 1000,
          },
        ],
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (tempHome) rmSync(tempHome, { recursive: true, force: true })
  })

  it('maps OpenCode SQLite sessions into Mission Control session stats', async () => {
    const { scanOpenCodeSessions } = await import('@/lib/opencode-sessions')
    const sessions = scanOpenCodeSessions(10)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'ses_open_1',
      projectId: 'proj_1',
      projectSlug: 'opencode-project',
      projectPath: '/tmp/opencode-project',
      title: 'OpenCode inspection',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      version: '1.4.3',
      userMessages: 1,
      assistantMessages: 1,
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      isActive: true,
    })
  })

  it('merges sessions across multiple OpenCode databases and prefers explicit OPENCODE_DB_PATH', async () => {
    const opencodeDir = join(tempHome, '.local', 'share', 'opencode')
    writeFileSync(join(opencodeDir, 'opencode.db'), '')
    writeFileSync(join(opencodeDir, 'opencode-older.db'), '')

    dbRowsByName['opencode.db'] = {
      session: [
        {
          id: 'ses_open_2',
          project_id: 'proj_2',
          parent_id: null,
          slug: 'second-wolf',
          directory: '/tmp/opencode-project-2',
          title: 'Second session',
          version: '1.4.4',
          share_url: null,
          summary_additions: null,
          summary_deletions: null,
          summary_files: null,
          summary_diffs: null,
          revert: null,
          permission: null,
          time_created: Date.now() - 20000,
          time_updated: Date.now() - 2000,
          time_compacting: null,
          time_archived: null,
          workspace_id: null,
        },
      ],
      project: [{ id: 'proj_2', worktree: '/tmp/opencode-project-2' }],
      message: [
        {
          data: JSON.stringify({ role: 'assistant', providerID: 'openai', modelID: 'gpt-5' }),
          time_created: Date.now() - 2000,
          time_updated: Date.now() - 2000,
        },
      ],
    }
    dbRowsByName['opencode-older.db'] = {
      session: [
        {
          id: 'ses_open_old',
          project_id: 'proj_old',
          parent_id: null,
          slug: 'old-wolf',
          directory: '/tmp/opencode-old',
          title: 'Old session',
          version: '1.4.0',
          share_url: null,
          summary_additions: null,
          summary_deletions: null,
          summary_files: null,
          summary_diffs: null,
          revert: null,
          permission: null,
          time_created: Date.now() - 30000,
          time_updated: Date.now() - 3000,
          time_compacting: null,
          time_archived: null,
          workspace_id: null,
        },
      ],
      project: [{ id: 'proj_old', worktree: '/tmp/opencode-old' }],
      message: [
        {
          data: JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-opus-4-1' }),
          time_created: Date.now() - 3000,
          time_updated: Date.now() - 3000,
        },
      ],
    }

    const { scanOpenCodeSessions } = await import('@/lib/opencode-sessions')
    const merged = scanOpenCodeSessions(10)
    expect(merged.map((session) => session.sessionId).sort()).toEqual(['ses_open_1', 'ses_open_2', 'ses_open_old'])

    process.env.OPENCODE_DB_PATH = join(opencodeDir, 'opencode.db')
    const explicitOnly = scanOpenCodeSessions(10)
    expect(explicitOnly.map((session) => session.sessionId)).toEqual(['ses_open_2'])
    delete process.env.OPENCODE_DB_PATH
  })
})
