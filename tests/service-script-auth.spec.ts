import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'

const execFileAsync = promisify(execFile)
const TEST_KEY = 'service-test-key-123'

async function runWorker(baseUrl: string, env: Record<string, string>, args: string[]) {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-worker-auth-'))
  return execFileAsync('pnpm', ['worker', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOG_DIR: logDir,
      MISSION_CONTROL_URL: baseUrl,
      ...env,
    },
  })
}

async function expectRunToFailWith(outputText: string, runner: Promise<{ stdout: string; stderr: string }>) {
  try {
    await runner
    throw new Error('Expected command to fail but it succeeded')
  } catch (err) {
    const stdout = String((err as { stdout?: string }).stdout ?? '')
    const stderr = String((err as { stderr?: string }).stderr ?? '')
    expect(`${stdout}\n${stderr}`).toContain(outputText)
  }
}

function createMockMissionControlServer(expectedApiKey: string) {
  const server = http.createServer((req, res) => {
    const apiKey = req.headers['x-api-key']
    const authed = apiKey === expectedApiKey

    if (req.url === '/api/status' && req.method === 'GET') {
      if (!authed) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.url === '/api/notifications/deliver' && req.method === 'POST') {
      if (!authed) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'success', delivered: 0, errors: 0, total_processed: 0 }))
      return
    }

    if (req.url?.startsWith('/api/agents') && req.method === 'GET') {
      if (!authed) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ agents: [] }))
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  return {
    async start() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Failed to bind mock server')
      return `http://127.0.0.1:${address.port}`
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

test.describe('service worker auth', () => {
  test('notifications worker requires service auth and succeeds with API key', async () => {
    const mc = createMockMissionControlServer(TEST_KEY)
    const baseUrl = await mc.start()

    try {
      await expectRunToFailWith(
        'HTTP 401',
        runWorker(
          baseUrl,
          {
            MISSION_CONTROL_SERVICE_API_KEY: '',
            API_KEY: '',
          },
          ['notifications']
        )
      )

      const ok = await runWorker(
        baseUrl,
        {
          MISSION_CONTROL_SERVICE_API_KEY: TEST_KEY,
        },
        ['notifications']
      )
      expect(ok.stdout).toContain('Notification delivery completed successfully')
    } finally {
      await mc.stop()
    }
  })

  test('heartbeat worker requires service auth and succeeds with API key', async () => {
    const mc = createMockMissionControlServer(TEST_KEY)
    const baseUrl = await mc.start()

    try {
      await expectRunToFailWith(
        'HTTP 401',
        runWorker(
          baseUrl,
          {
            MISSION_CONTROL_SERVICE_API_KEY: '',
            API_KEY: '',
          },
          ['heartbeat']
        )
      )

      const ok = await runWorker(
        baseUrl,
        {
          MISSION_CONTROL_SERVICE_API_KEY: TEST_KEY,
        },
        ['heartbeat']
      )
      expect(ok.stdout).toContain('No agents found with session keys configured')
    } finally {
      await mc.stop()
    }
  })
})
