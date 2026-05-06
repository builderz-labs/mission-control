import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import capabilities from '../../../scripts/local-capabilities.cjs'

const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/local-capabilities.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const CLI_TIMEOUT_MS = 30000

function runScript(): {
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  error?: string
} {
  const result = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    timeout: CLI_TIMEOUT_MS,
  })

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
  }
}

function parseCliJson(run: {
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  error?: string
}): Record<string, any> {
  expect(run.error).toBeUndefined()
  expect(run.signal).toBeNull()
  expect(run.status).toBe(0)
  expect(run.stderr.trim()).toBe('')
  expect(run.stdout.trim()).not.toBe('')

  return JSON.parse(run.stdout)
}

let cliRun: {
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  error?: string
}

describe('local-capabilities helpers', () => {
  it('extracts the first non-empty line from command output', () => {
    expect(capabilities.firstNonEmptyLine('\n\nv1.2.3\nextra')).toBe('v1.2.3')
  })

  it('parses installed Ollama model names from ollama list output', () => {
    const models = capabilities.parseOllamaModels([
      'NAME               ID              SIZE      MODIFIED',
      'llama3.2:latest    abc123          2.0 GB    2 days ago',
      'mistral:7b         def456          4.1 GB    5 days ago',
    ].join('\n'))

    expect(models).toEqual(['llama3.2:latest', 'mistral:7b'])
  })

  it('reports FAIL when a critical capability is missing', () => {
    const summary = capabilities.summarizeCapabilities({
      node: { available: true },
      pnpm: { available: false },
      git: { available: true },
      ollama: { available: true },
      aider: { available: true },
      github_cli: { available: false },
      powershell: { available: true },
    })

    expect(summary.status).toBe('FAIL')
    expect(summary.critical_missing).toEqual(['pnpm'])
    expect(summary.important_missing).toEqual([])
    expect(summary.optional_missing).toEqual(['github_cli'])
  })

  it('reports WARN when an important capability is missing and critical ones exist', () => {
    const summary = capabilities.summarizeCapabilities({
      node: { available: true },
      pnpm: { available: true },
      git: { available: true },
      ollama: { available: false },
      aider: { available: true },
      github_cli: { available: false },
      powershell: { available: true },
    })

    expect(summary.status).toBe('WARN')
    expect(summary.critical_missing).toEqual([])
    expect(summary.important_missing).toEqual(['ollama'])
    expect(summary.optional_missing).toEqual(['github_cli'])
  })

  it('reports PASS when only optional capabilities are missing', () => {
    const summary = capabilities.summarizeCapabilities({
      node: { available: true },
      pnpm: { available: true },
      git: { available: true },
      ollama: { available: true },
      aider: { available: true },
      github_cli: { available: false },
      powershell: { available: false },
    })

    expect(summary.status).toBe('PASS')
    expect(summary.critical_missing).toEqual([])
    expect(summary.important_missing).toEqual([])
    expect(summary.optional_missing).toEqual(['github_cli', 'powershell'])
  })
})

describe('local-capabilities CLI', () => {
  beforeAll(() => {
    cliRun = runScript()
  })

  it('exits successfully', () => {
    expect(cliRun.error).toBeUndefined()
    expect(cliRun.signal).toBeNull()
    expect(cliRun.status).toBe(0)
  })

  it('emits valid JSON', () => {
    expect(() => parseCliJson(cliRun)).not.toThrow()
  })

  it('labels output as OBSERVE ONLY', () => {
    const cliJson = parseCliJson(cliRun)
    expect(cliJson.label).toBe('OBSERVE ONLY')
  })

  it('includes required top-level fields', () => {
    const cliJson = parseCliJson(cliRun)
    for (const field of ['agent', 'label', 'status', 'checked_at', 'critical_missing', 'important_missing', 'optional_missing', 'capabilities', 'warnings', 'recommended_actions']) {
      expect(cliJson).toHaveProperty(field)
    }
  })

  it('reports the expected tool keys', () => {
    const cliJson = parseCliJson(cliRun)
    for (const field of ['node', 'pnpm', 'git', 'github_cli', 'powershell', 'aider', 'ollama']) {
      expect(cliJson.capabilities).toHaveProperty(field)
    }
  })

  it('keeps Ollama models as an array', () => {
    const cliJson = parseCliJson(cliRun)
    expect(Array.isArray(cliJson.capabilities.ollama.models)).toBe(true)
  })

  it('uses PASS, WARN, or FAIL status values', () => {
    const cliJson = parseCliJson(cliRun)
    expect(['PASS', 'WARN', 'FAIL']).toContain(cliJson.status)
  })

  it('does not contain unsafe install or model-pull commands in source', () => {
    const source = fs.readFileSync(SCRIPT_PATH, 'utf-8')
    for (const forbidden of [
      'ollama pull',
      'pnpm install',
      'npm install',
      'curl ',
      'wget ',
      'Invoke-WebRequest',
      'iwr ',
      'irm ',
    ]) {
      expect(source, `forbidden command found: "${forbidden}"`).not.toContain(forbidden)
    }
  })
})
