import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config', () => ({
  config: { memoryDir: '' },
}))

import { config } from '../config'
import { archivePath, archiveSessionMeta, renderArchiveMarkdown } from '../session-archive'

describe('session archive', () => {
  afterEach(() => {
    config.memoryDir = ''
  })

  it('renders frontmatter and prompt', () => {
    const md = renderArchiveMarkdown({
      kind: 'claude-code',
      sessionId: 'abc',
      projectSlug: 'stillpoint-builders',
      lastUserPrompt: 'Cover the connector authorization gate',
    })
    expect(md).toContain('kind: claude-code')
    expect(md).toContain('Cover the connector authorization gate')
  })

  it('strips control characters from yaml frontmatter values', () => {
    const md = renderArchiveMarkdown({
      kind: 'claude-code',
      sessionId: 'abc',
      projectSlug: 'mc',
      workingDir: '/tmp/app\nkind: injected',
    })
    expect(md).toContain('working_dir: /tmp/app kind: injected')
    expect(md).not.toMatch(/^kind: injected$/m)
  })

  it('writes under sessions/project/kind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-archive-'))
    config.memoryDir = dir
    const relative = archiveSessionMeta({
      kind: 'codex-cli',
      sessionId: 'sess-1',
      workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
      lastUserPrompt: 'Phase K',
      lastActivity: Date.now(),
    })
    expect(relative).toBe(archivePath('codex-cli', 'stillpoint-builders', 'sess-1'))
    const body = readFileSync(join(dir, relative!), 'utf8')
    expect(body).toContain('Phase K')
  })

  it('skips non-tree kinds', () => {
    expect(archiveSessionMeta({ kind: 'hermes', sessionId: 'x' })).toBeNull()
  })

  it('parses role-labeled archive bodies', async () => {
    const { parseArchiveMarkdown, renderTranscriptBody } = await import('../session-archive')
    const md = renderArchiveMarkdown({
      kind: 'grok',
      sessionId: 'g1',
      projectSlug: 'mc',
      lastUserPrompt: 'Audit the rail',
      body: renderTranscriptBody([
        { role: 'user', parts: [{ type: 'text', text: 'Audit the rail' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Collapsed by default.' }] },
      ]),
    })
    const messages = parseArchiveMarkdown(md)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1].parts[0]).toEqual({ type: 'text', text: 'Collapsed by default.' })
  })
})
