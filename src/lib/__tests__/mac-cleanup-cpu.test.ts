import { describe, expect, it } from 'vitest'
import { parseHighCpuWorkers } from '@/lib/mac-cleanup/reclaim-cpu'
import { toolIsActive } from '@/lib/mac-cleanup/reclaim-targets'

describe('parseHighCpuWorkers', () => {
  it('selects idle-tree build workers and ignores agent CLIs', () => {
    const stdout = [
      '  111  40.0 node /Users/t/.nvm/versions/node/v24.16.0/bin/node-gyp rebuild',
      '  222  55.0 claude --print do work',
      '  333   2.0 node-gyp rebuild',
    ].join('\n')
    const rows = parseHighCpuWorkers(stdout)
    expect(rows.map((row) => row.pid)).toEqual([111])
  })
})

describe('toolIsActive', () => {
  it('detects npm without treating an editor as busy', () => {
    expect(toolIsActive('npm', '/usr/bin/npm install')).toBe(true)
    expect(toolIsActive('npm', 'Cursor Helper (Plugin): extension-host')).toBe(false)
    expect(toolIsActive('pnpm', 'pnpm test')).toBe(true)
  })
})
