import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeAgentInbox } from '@/lib/agent-inbox'

describe('writeAgentInbox', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it('writes a markdown drop under workspace-{name}/inbox', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-inbox-'))
    const filePath = writeAgentInbox('grok', 'operator', 'hello fleet', tempDir)
    expect(filePath.startsWith(path.join(tempDir, 'workspace-grok', 'inbox'))).toBe(true)
    const body = readFileSync(filePath, 'utf8')
    expect(body).toContain('# From operator')
    expect(body).toContain('hello fleet')
  })

  it('rejects path-like agent names', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-inbox-'))
    expect(() => writeAgentInbox('../etc', 'op', 'nope', tempDir)).toThrow(/Invalid agent name/)
  })
})
