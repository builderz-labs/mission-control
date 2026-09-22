import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fixtureDir: string

function writeSessionFixture(dir: string, sessionId: string, mtimeMs: number): string {
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const line = JSON.stringify({
    sessionId,
    type: 'user',
    timestamp: new Date(mtimeMs).toISOString(),
    message: { role: 'user', content: 'hi' },
  })
  fs.writeFileSync(filePath, `${line}\n`)
  const mtime = new Date(mtimeMs)
  fs.utimesSync(filePath, mtime, mtime)
  return filePath
}

async function loadScanClaudeSessions(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const mod = await import('./claude-sessions')
  return mod.scanClaudeSessions
}

describe('scanClaudeSessions session window', () => {
  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-claude-home-'))
    const projectDir = path.join(fixtureDir, 'projects', 'test-project')
    fs.mkdirSync(projectDir, { recursive: true })

    const now = Date.now()
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000

    writeSessionFixture(projectDir, 'fresh-session', now)
    writeSessionFixture(projectDir, 'old-session', tenDaysAgo)
  })

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true })
    delete process.env.MC_CLAUDE_HOME
    delete process.env.MC_SESSION_SCAN_WINDOW_MS
    vi.resetModules()
  })

  it('skips files outside the configured window', async () => {
    const scanClaudeSessions = await loadScanClaudeSessions({
      MC_CLAUDE_HOME: fixtureDir,
      MC_SESSION_SCAN_WINDOW_MS: String(24 * 60 * 60 * 1000), // 1 day
    })

    const sessions = await scanClaudeSessions()

    expect(sessions.map(s => s.sessionId)).toEqual(['fresh-session'])
  })

  it('scans everything when the window is unset (default, unchanged behavior)', async () => {
    const scanClaudeSessions = await loadScanClaudeSessions({
      MC_CLAUDE_HOME: fixtureDir,
      MC_SESSION_SCAN_WINDOW_MS: undefined,
    })

    const sessions = await scanClaudeSessions()

    expect(sessions.map(s => s.sessionId).sort()).toEqual(['fresh-session', 'old-session'])
  })
})
