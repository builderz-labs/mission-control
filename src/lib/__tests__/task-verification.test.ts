import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import {
  captureWorkspaceSnapshot,
  diffWorkspaceSnapshots,
  findWorkspaceRootFromPath,
  verifyTaskExecution,
} from '@/lib/task-verification'

describe('task verification helpers', () => {
  it('finds the nearest workspace root from a nested file', () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-verify-root-'))
    const nested = join(root, 'doc')
    mkdirSync(nested)
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}')
    writeFileSync(join(nested, 'Todo.md'), '- [ ] test')

    expect(findWorkspaceRootFromPath(join(nested, 'Todo.md'))).toBe(root)

    rmSync(root, { recursive: true, force: true })
  })

  it('detects workspace changes between snapshots', () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-verify-diff-'))
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}')
    writeFileSync(join(root, 'src.ts'), 'const a = 1\n')
    const before = captureWorkspaceSnapshot(root)

    writeFileSync(join(root, 'src.ts'), 'const a = 2\n')
    const after = captureWorkspaceSnapshot(root)

    expect(diffWorkspaceSnapshots(before, after)).toContain('src.ts')

    rmSync(root, { recursive: true, force: true })
  })

  it('fails worker-stage verification when no workspace changes exist', () => {
    const result = verifyTaskExecution({
      taskStatus: 'in_progress',
      output: 'Completed successfully',
      beforeSnapshot: {},
      afterSnapshot: {},
    })

    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/verified workspace changes/i)
  })

  it('allows review-stage verification without file edits when a prior verified diff exists', () => {
    const result = verifyTaskExecution({
      taskStatus: 'review',
      output: 'Reviewed patch and validated acceptance criteria.',
      beforeSnapshot: {},
      afterSnapshot: {},
      priorVerifiedChangedFiles: ['src/App.tsx'],
    })

    expect(result.passed).toBe(true)
  })
})
