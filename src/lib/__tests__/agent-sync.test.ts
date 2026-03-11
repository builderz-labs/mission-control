import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('removeAgentFromConfig', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it('removes matching agent entries by id and display name', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-sync-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            list: [
              { id: 'jarv', name: 'jarv', identity: { name: 'jarv' } },
              { id: 'neo', identity: { name: 'Neo' } },
              { id: 'keep-me', name: 'keep-me', identity: { name: 'keep-me' } },
            ],
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    const { removeAgentFromConfig } = await import('@/lib/agent-sync')
    const result = await removeAgentFromConfig({ id: 'neo', name: 'Neo' })

    expect(result.removed).toBe(true)
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.agents.list).toEqual([
      { id: 'jarv', name: 'jarv', identity: { name: 'jarv' } },
      { id: 'keep-me', name: 'keep-me', identity: { name: 'keep-me' } },
    ])
  })

  it('is a no-op when no matching agent entry exists', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-sync-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    writeFileSync(
      configPath,
      JSON.stringify({ agents: { list: [{ id: 'keep-me', name: 'keep-me' }] } }, null, 2) + '\n',
      'utf-8',
    )

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    const { removeAgentFromConfig } = await import('@/lib/agent-sync')
    const result = await removeAgentFromConfig({ id: 'missing', name: 'missing' })

    expect(result.removed).toBe(false)
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.agents.list).toEqual([{ id: 'keep-me', name: 'keep-me' }])
  })

  it('normalizes nested model.primary payloads when writing config', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-sync-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          list: [
            {
              id: 'neo',
              model: {
                primary: {
                  primary: 'anthropic/claude-sonnet-4-20250514',
                },
                fallbacks: ['openai/codex-mini-latest', 'openai/codex-mini-latest'],
              },
            },
          ],
        },
      }, null, 2) + '\n',
      'utf-8',
    )

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    const { writeAgentToConfig } = await import('@/lib/agent-sync')
    await writeAgentToConfig({
      id: 'neo',
      model: {
        primary: {
          primary: 'anthropic/claude-sonnet-4-20250514',
        },
        fallbacks: ['openrouter/anthropic/claude-sonnet-4'],
      },
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.agents.list[0].model).toEqual({
      primary: 'anthropic/claude-sonnet-4-20250514',
      fallbacks: ['openrouter/anthropic/claude-sonnet-4'],
    })
  })
})
