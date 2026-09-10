import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempHome = ''

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return tempHome
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

describe('scanKimiSessions', () => {
  beforeEach(() => {
    vi.resetModules()
    tempHome = mkdtempSync(join(tmpdir(), 'mc-kimi-test-'))
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('joins session_index.jsonl with state.json', async () => {
    const sessionDir = join(tempHome, '.kimi-code', 'sessions', 'wd_dev', 'session_abc')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(tempHome, '.kimi-code', 'session_index.jsonl'), `${JSON.stringify({
      sessionId: 'session_abc',
      sessionDir,
      workDir: '/Users/dev/actz-may',
    })}\n`)
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
      id: 'session_abc',
      cwd: '/Users/dev/actz-may',
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now(),
      lastPrompt: 'review the fleet map',
      title: 'fleet review',
    }))

    const { scanKimiSessions } = await import('@/lib/kimi-sessions')
    const sessions = scanKimiSessions(10)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'session_abc',
      projectPath: '/Users/dev/actz-may',
      projectSlug: 'actz-may',
      model: 'kimi-code/k3',
      lastUserPrompt: 'review the fleet map',
      title: 'fleet review',
      isActive: true,
    })
  })

  it('parses ISO timestamps and workDir', async () => {
    const sessionDir = join(tempHome, '.kimi-code', 'sessions', 'wd_dev', 'session_iso')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(tempHome, '.kimi-code', 'session_index.jsonl'), `${JSON.stringify({
      sessionId: 'session_iso',
      sessionDir,
      workDir: '/Users/dev/stillpoint-builders',
    })}\n`)
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
      title: 'Gate review',
      workDir: '/Users/dev/stillpoint-builders',
      createdAt: '2026-07-30T21:47:41.386Z',
      updatedAt: new Date().toISOString(),
      lastPrompt: 'Cover the connector',
    }))

    const { scanKimiSessions } = await import('@/lib/kimi-sessions')
    const sessions = scanKimiSessions(10)
    expect(sessions[0]).toMatchObject({
      sessionId: 'session_iso',
      projectSlug: 'stillpoint-builders',
      lastUserPrompt: 'Cover the connector',
      isActive: true,
    })
  })

  it('ignores sessionDir outside the home directory', async () => {
    mkdirSync(join(tempHome, '.kimi-code'), { recursive: true })
    writeFileSync(join(tempHome, '.kimi-code', 'session_index.jsonl'), `${JSON.stringify({
      sessionId: 'session_escape',
      sessionDir: '/etc',
      workDir: '/etc',
    })}\n`)
    const { scanKimiSessions } = await import('@/lib/kimi-sessions')
    expect(scanKimiSessions()).toEqual([])
  })

  it('ignores kimi-claw sibling sessions', async () => {
    const clawDir = join(tempHome, '.kimi', 'kimi-claw', 'sessions', 'session_claw')
    mkdirSync(clawDir, { recursive: true })
    mkdirSync(join(tempHome, '.kimi-code'), { recursive: true })
    writeFileSync(join(tempHome, '.kimi-code', 'session_index.jsonl'), `${JSON.stringify({
      sessionId: 'session_claw',
      sessionDir: clawDir,
      workDir: '/tmp',
    })}\n`)

    const { scanKimiSessions } = await import('@/lib/kimi-sessions')
    expect(scanKimiSessions()).toEqual([])
  })
})
