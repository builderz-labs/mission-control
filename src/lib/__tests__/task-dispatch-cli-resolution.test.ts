import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Source-contract tests in the style of task-dispatch-claude-runtime.test.ts:
// The #933 fix has ordering and path-use guarantees that are structural
// properties of task-dispatch.ts. These assertions pin them so a refactor
// cannot silently revert to spawning bare 'claude' when a concrete path was found.
const source = readFileSync(join(process.cwd(), 'src', 'lib', 'task-dispatch.ts'), 'utf8')

describe('CLI binary path resolution (#933)', () => {
  it('defines getClaudeCliBinaryPath() that caches and returns the resolved path', () => {
    expect(source).toContain('function getClaudeCliBinaryPath()')
    expect(source).toContain('claudeCliBinaryPath: string | false | null')
    
    // Verify it checks Docker paths first
    expect(source).toContain("'/home/nextjs/.local/bin/claude'")
    expect(source).toContain("'/usr/local/bin/claude'")
    expect(source).toContain("'/usr/bin/claude'")
    
    // Verify it checks Windows path
    expect(source).toContain("'.local', 'bin', 'claude.exe'")
    
    // Verify it falls back to PATH check
    expect(source).toContain("spawnSync('claude', ['--version']")
    
    // Verify it caches all outcomes (path string, or false)
    expect(source).toContain('claudeCliBinaryPath = p')
    expect(source).toContain('claudeCliBinaryPath = windowsPath')
    expect(source).toContain("claudeCliBinaryPath = 'claude'")
    expect(source).toContain('claudeCliBinaryPath = false')
  })

  it('defines getCodexCliBinaryPath() with similar structure', () => {
    expect(source).toContain('function getCodexCliBinaryPath()')
    expect(source).toContain('codexCliBinaryPath: string | false | null')
    expect(source).toContain("spawnSync('codex', ['--version']")
    expect(source).toContain("codexCliBinaryPath = 'codex'")
    expect(source).toContain('codexCliBinaryPath = false')
  })

  it('isClaudeCliAvailable delegates to getClaudeCliBinaryPath', () => {
    expect(source).toContain('function isClaudeCliAvailable()')
    expect(source).toContain('return getClaudeCliBinaryPath() !== null')
  })

  it('isCodexCliAvailable delegates to getCodexCliBinaryPath', () => {
    expect(source).toContain('function isCodexCliAvailable()')
    expect(source).toContain('return getCodexCliBinaryPath() !== null')
  })
})

describe('spawn uses resolved path (#933 regression)', () => {
  it('verifies spawn receives the resolved path, not bare "claude"', () => {
    // This is a source-level contract test similar to task-dispatch-claude-runtime.test.ts
    const fs = require('node:fs')
    const path = require('node:path')
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'lib', 'task-dispatch.ts'),
      'utf8'
    )

    // Verify getClaudeCliBinaryPath exists and returns a path
    expect(source).toContain('function getClaudeCliBinaryPath()')
    expect(source).toContain('claudeCliBinaryPath = p')
    expect(source).toContain('claudeCliBinaryPath = windowsPath')
    expect(source).toContain("claudeCliBinaryPath = 'claude'")

    // Verify spawn uses the resolved path
    expect(source).toContain('const claudePath = getClaudeCliBinaryPath()')
    expect(source).toContain('spawn(claudePath, args')

    // Verify same pattern for codex
    expect(source).toContain('function getCodexCliBinaryPath()')
    expect(source).toContain('const codexPath = getCodexCliBinaryPath()')
    expect(source).toContain('spawn(codexPath, args')
  })

  it('verifies availability check uses the same resolution logic', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'lib', 'task-dispatch.ts'),
      'utf8'
    )

    // isClaudeCliAvailable must delegate to getClaudeCliBinaryPath
    expect(source).toContain('function isClaudeCliAvailable()')
    expect(source).toContain('return getClaudeCliBinaryPath() !== null')

    // Same for codex
    expect(source).toContain('function isCodexCliAvailable()')
    expect(source).toContain('return getCodexCliBinaryPath() !== null')
  })
})
