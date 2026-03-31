import { afterEach, describe, expect, it, vi } from 'vitest'

const { runCommand } = vi.hoisted(() => ({
  runCommand: vi.fn(),
}))

vi.mock('../command', () => ({
  runCommand,
}))

import { listOpenClawProcesses, parsePgrepOutput } from '../openclaw-processes'

describe('openclaw process helpers', () => {
  afterEach(() => {
    runCommand.mockReset()
  })

  it('parses pgrep output into pid and command pairs', () => {
    expect(
      parsePgrepOutput('123 /usr/local/bin/openclaw gateway --port 18789\n456 clawdbot run main\n')
    ).toEqual([
      { pid: '123', command: '/usr/local/bin/openclaw gateway --port 18789' },
      { pid: '456', command: 'clawdbot run main' },
    ])
  })

  it('deduplicates processes gathered from multiple probes', async () => {
    runCommand
      .mockResolvedValueOnce({
        stdout: '123 /usr/local/bin/openclaw gateway --port 18789\n456 openclaw agent --agent main\n',
        stderr: '',
        code: 0,
      })
      .mockResolvedValueOnce({
        stdout: '456 openclaw agent --agent main\n789 clawdbot run main\n',
        stderr: '',
        code: 0,
      })

    await expect(listOpenClawProcesses()).resolves.toEqual([
      { pid: '123', command: '/usr/local/bin/openclaw gateway --port 18789' },
      { pid: '456', command: 'openclaw agent --agent main' },
      { pid: '789', command: 'clawdbot run main' },
    ])
  })

  it('ignores no-match probe failures', async () => {
    runCommand
      .mockRejectedValueOnce(new Error('Command failed (pgrep -fal openclaw): '))
      .mockResolvedValueOnce({
        stdout: '789 clawdbot run main\n',
        stderr: '',
        code: 0,
      })

    await expect(listOpenClawProcesses()).resolves.toEqual([
      { pid: '789', command: 'clawdbot run main' },
    ])
  })
})
