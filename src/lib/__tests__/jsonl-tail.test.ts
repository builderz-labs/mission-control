import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { findNamedJsonl, readJsonlTailLines } from '../jsonl-tail'
import { parseClaudeTranscriptLines } from '../claude-transcript'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('jsonl tail + claude transcript', () => {
  it('finds a session jsonl by id without reading other files', () => {
    const root = join(tmpdir(), `mc-jsonl-${Date.now()}`)
    dirs.push(root)
    const nested = join(root, 'proj')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'other.jsonl'), '{}\n')
    writeFileSync(join(nested, 'sess-1.jsonl'), '{"type":"user"}\n')
    expect(findNamedJsonl(root, 'sess-1')?.endsWith('sess-1.jsonl')).toBe(true)
    expect(findNamedJsonl(root, '../etc/passwd')).toBeNull()
    expect(findNamedJsonl(root, 's')).toBeNull()
  })

  it('tails the last lines and parses Claude user/assistant messages', () => {
    const root = join(tmpdir(), `mc-jsonl-parse-${Date.now()}`)
    dirs.push(root)
    mkdirSync(root, { recursive: true })
    const id = 'e4deed8c-8578-4c6d-a421-175443c87942'
    const lines = [
      JSON.stringify({ type: 'custom-title', customTitle: 'Franchise readiness agent handoff', sessionId: id }),
      JSON.stringify({ type: 'user', sessionId: id, timestamp: '2026-09-03T00:00:00.000Z', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', sessionId: id, timestamp: '2026-09-03T00:00:01.000Z', message: { content: [{ type: 'text', text: 'world' }] } }),
    ]
    writeFileSync(join(root, `${id}.jsonl`), `${lines.join('\n')}\n`)
    const parsed = parseClaudeTranscriptLines(readJsonlTailLines(join(root, `${id}.jsonl`)), id, 40)
    expect(parsed.map((row) => row.role)).toEqual(['user', 'assistant'])
    expect(parsed[0].parts[0]).toEqual({ type: 'text', text: 'hello' })
  })
})
