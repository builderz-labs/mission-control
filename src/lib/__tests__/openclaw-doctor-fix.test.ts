import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { archiveOrphanTranscriptsForStateDir } from '@/lib/openclaw-doctor-fix'

const tempDirs: string[] = []

function makeStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-openclaw-fix-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('archiveOrphanTranscriptsForStateDir', () => {
  it('archives only unreferenced primary transcript files', () => {
    const stateDir = makeStateDir()
    const sessionsDir = path.join(stateDir, 'agents', 'jarv', 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })

    fs.writeFileSync(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
      'agent:jarv:main': {
        sessionId: 'keep-session',
      },
      'agent:jarv:custom': {
        sessionFile: path.join(sessionsDir, 'custom-session.jsonl'),
      },
    }))

    fs.writeFileSync(path.join(sessionsDir, 'keep-session.jsonl'), '{"type":"session"}\n')
    fs.writeFileSync(path.join(sessionsDir, 'custom-session.jsonl'), '{"type":"session"}\n')
    fs.writeFileSync(path.join(sessionsDir, 'orphan-session.jsonl'), '{"type":"session"}\n')
    fs.writeFileSync(path.join(sessionsDir, 'orphan-session.jsonl.reset.2026-03-11T00-00-00.000Z'), 'old\n')

    const result = archiveOrphanTranscriptsForStateDir(stateDir)

    expect(result).toEqual({ archivedOrphans: 1, storesScanned: 1 })
    expect(fs.existsSync(path.join(sessionsDir, 'keep-session.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(sessionsDir, 'custom-session.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(sessionsDir, 'orphan-session.jsonl'))).toBe(false)
    expect(
      fs.readdirSync(sessionsDir).some(name => name.startsWith('orphan-session.jsonl.deleted.'))
    ).toBe(true)
  })
})
