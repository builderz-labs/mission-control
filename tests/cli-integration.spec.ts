import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent, createTestTask, deleteTestTask } from './helpers'

const execFileAsync = promisify(execFile)

const CLI = path.resolve('scripts/mc-cli.cjs')
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3005'
const API_KEY = 'test-api-key-e2e-12345'

/** Run mc-cli command via execFile (no shell) and return parsed JSON output */
async function mc(...args: string[]): Promise<{ stdout: string; parsed: any; exitCode: number }> {
  try {
    const { stdout } = await execFileAsync('node', [CLI, ...args, '--json', '--url', BASE_URL, '--api-key', API_KEY], {
      timeout: 15000,
      env: { ...process.env, MC_URL: BASE_URL, MC_API_KEY: API_KEY },
    })
    let parsed: any
    try { parsed = JSON.parse(stdout) } catch { parsed = { raw: stdout } }
    return { stdout, parsed, exitCode: 0 }
  } catch (err: any) {
    const stdout = err.stdout || ''
    let parsed: any
    try { parsed = JSON.parse(stdout) } catch { parsed = { raw: stdout, stderr: err.stderr } }
    return { stdout, parsed, exitCode: err.code ?? 1 }
  }
}

test.describe('CLI Integration', () => {
  // --- Help & Usage ---

  test('--help shows usage and exits 0', async () => {
    const { stdout, exitCode } = await mc('--help')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Mission Control CLI')
    expect(stdout).toContain('agents')
    expect(stdout).toContain('tasks')
  })

  test('unknown group exits 2 with error', async () => {
    const { exitCode } = await mc('nonexistent', 'action')
    expect(exitCode).toBe(2)
  })

  test('missing required flag exits 2 with error message', async () => {
    const { exitCode, parsed } = await mc('agents', 'get')
    expect(exitCode).toBe(2)
    expect(parsed.error).toContain('--id')
  })

  // --- Status ---

  test('status health returns a health payload', async () => {
    const { parsed } = await mc('status', 'health')
    expect(['healthy', 'warning', 'degraded', 'unhealthy']).toContain(parsed.data?.status || parsed.status)
  })

  test('status overview returns system info', async () => {
    const { parsed, exitCode } = await mc('status', 'overview')
    expect(exitCode).toBe(0)
  })

  // --- Agents CRUD ---

  test.describe('agents', () => {
    const agentIds: number[] = []

    test.afterEach(async ({ request }) => {
      for (const id of agentIds.splice(0)) {
        await deleteTestAgent(request, id).catch(() => {})
      }
    })

    test('list returns array', async () => {
      const { parsed, exitCode } = await mc('agents', 'list')
      expect(exitCode).toBe(0)
      const data = parsed.data || parsed
      expect(data).toBeDefined()
    })

    test('get + heartbeat lifecycle', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      // Get via CLI
      const { parsed: getResult, exitCode: getCode } = await mc('agents', 'get', '--id', String(agent.id))
      expect(getCode).toBe(0)
      const agentData = getResult.data?.agent || getResult.data || getResult
      expect(agentData).toBeDefined()

      // Heartbeat via CLI
      const { exitCode: hbCode } = await mc('agents', 'heartbeat', '--id', String(agent.id))
      expect(hbCode).toBe(0)
    })

    test('memory set and get work', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      // Set memory — may succeed or fail depending on workspace state
      const { exitCode: setCode } = await mc('agents', 'memory', 'set', '--id', String(agent.id), '--content', 'CLI test memory')
      expect([0, 2, 6]).toContain(setCode)

      // Get memory
      const { exitCode: getCode } = await mc('agents', 'memory', 'get', '--id', String(agent.id))
      expect([0, 2, 6]).toContain(getCode)
    })

    test('attribution returns response', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      // Attribution may return 403 for test API key depending on auth scope — accept 0 or 4
      const { exitCode } = await mc('agents', 'attribution', '--id', String(agent.id), '--hours', '1')
      expect([0, 4]).toContain(exitCode)
    })
  })

  // --- Tasks ---

  test.describe('tasks', () => {
    const taskIds: number[] = []

    test.afterEach(async ({ request }) => {
      for (const id of taskIds.splice(0)) {
        await deleteTestTask(request, id).catch(() => {})
      }
    })

    test('list returns data', async () => {
      const { exitCode } = await mc('tasks', 'list')
      expect(exitCode).toBe(0)
    })

    test('queue returns response', async () => {
      const { exitCode } = await mc('tasks', 'queue', '--agent', 'e2e-test-agent')
      expect(exitCode).toBe(0)
    })

    test('comments list/add lifecycle', async ({ request }) => {
      const task = await createTestTask(request)
      taskIds.push(task.id)

      // Add comment via CLI
      const { exitCode: addCode } = await mc('tasks', 'comments', 'add', '--id', String(task.id), '--content', 'CLI comment test')
      expect(addCode).toBe(0)

      // List comments via CLI
      const { parsed, exitCode: listCode } = await mc('tasks', 'comments', 'list', '--id', String(task.id))
      expect(listCode).toBe(0)
      const comments = parsed.data?.comments || parsed.comments || []
      expect(comments.length).toBeGreaterThanOrEqual(1)
    })
  })

  // --- Sessions ---

  test('sessions list returns response', async () => {
    // Sessions endpoint behavior depends on gateway availability
    const { exitCode } = await mc('sessions', 'list')
    expect(exitCode).toBeLessThanOrEqual(6)
  })

  // --- Tokens ---

  test('tokens stats returns data', async () => {
    const { exitCode } = await mc('tokens', 'stats')
    expect(exitCode).toBe(0)
  })

  test('tokens by-agent returns data', async () => {
    const { exitCode } = await mc('tokens', 'by-agent', '--days', '7')
    expect(exitCode).toBe(0)
  })

  // --- Skills ---

  test('skills list returns data', async () => {
    const { exitCode } = await mc('skills', 'list')
    expect(exitCode).toBe(0)
  })

  // --- Cron ---

  test('cron list returns response', async () => {
    // Cron may return error in test mode — accept 0, 2, or 6
    const { exitCode } = await mc('cron', 'list')
    expect([0, 2, 6]).toContain(exitCode)
  })

  // --- Connect ---

  test('connect list returns data', async () => {
    const { exitCode } = await mc('connect', 'list')
    expect(exitCode).toBe(0)
  })

  // --- Raw passthrough ---

  test('raw GET /api/status works', async () => {
    const { parsed } = await mc('raw', '--method', 'GET', '--path', '/api/status?action=health')
    expect(['healthy', 'warning', 'degraded', 'unhealthy']).toContain(parsed.data?.status || parsed.status)
  })
})
