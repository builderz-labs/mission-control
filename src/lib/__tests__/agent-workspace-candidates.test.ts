import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { stateDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return { stateDir: mkdtempSync(join(tmpdir(), 'mc-openclaw-state-')) }
})
vi.mock('@/lib/config', () => ({ config: { openclawStateDir: stateDir } }))

import { getAgentWorkspaceCandidates } from '@/lib/agent-workspace'

const tempDirs: string[] = [stateDir]
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-agent-ws-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(1)) rmSync(dir, { recursive: true, force: true })
})

describe('getAgentWorkspaceCandidates', () => {
  it('returns nothing when no workspace exists', () => {
    expect(getAgentWorkspaceCandidates({}, 'ghost')).toEqual([])
  })

  it('uses the agent workspace_path set by local agent sync', () => {
    const dir = tempDir()
    expect(getAgentWorkspaceCandidates({}, 'one', dir)).toEqual([dir])
    expect(getAgentWorkspaceCandidates(null, 'one', `  ${dir}  `)).toEqual([dir])
  })

  it('prefers an explicit config.workspace over workspace_path', () => {
    const configured = tempDir()
    const synced = tempDir()
    expect(getAgentWorkspaceCandidates({ workspace: configured }, 'one', synced)).toEqual([configured, synced])
  })

  it('ignores a workspace_path that does not exist', () => {
    expect(getAgentWorkspaceCandidates({}, 'one', join(tmpdir(), 'mc-missing-workspace-dir'))).toEqual([])
  })

  it('still finds OpenClaw workspaces under the state dir', () => {
    mkdirSync(join(stateDir, 'workspace-builder'), { recursive: true })
    expect(getAgentWorkspaceCandidates({}, 'Builder', null)).toEqual([join(stateDir, 'workspace-builder')])
  })
})
