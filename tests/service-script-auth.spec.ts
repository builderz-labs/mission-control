import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'

const execFileAsync = promisify(execFile)
const TEST_KEY = 'service-test-key-123'

async function runScript(scriptPath: string, baseUrl: string, env: Record<string, string>) {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-script-auth-'))
  return execFileAsync('bash', [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOG_DIR: logDir,
      MISSION_CONTROL_URL: baseUrl,
      ...env,
    },
  })
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

test.describe('service script auth', () => {
  test('notification-daemon requires service auth and succeeds with API key', async () => {
    const script = path.join(process.cwd(), 'scripts/notification-daemon.sh')
    const mc = createMockMissionControlServer(TEST_KEY)
    const baseUrl = await mc.start()

    try {
      await expect(
        runScript(script, baseUrl, {
          MISSION_CONTROL_SERVICE_API_KEY: '',
          API_KEY: '',
        })
      ).rejects.toMatchObject({
        stdout: expect.stringContaining('HTTP 401'),
      })

      const ok = await runScript(script, baseUrl, {
        MISSION_CONTROL_SERVICE_API_KEY: TEST_KEY,
      })
      expect(ok.stdout).toContain('Notification delivery completed successfully')
    } finally {
      await mc.stop()
    }
  })

  test('agent-heartbeat requires service auth and succeeds with API key', async () => {
    const script = path.join(process.cwd(), 'scripts/agent-heartbeat.sh')
    const mc = createMockMissionControlServer(TEST_KEY)
    const baseUrl = await mc.start()

    try {
      await expect(
        runScript(script, baseUrl, {
          MISSION_CONTROL_SERVICE_API_KEY: '',
          API_KEY: '',
        })
      ).rejects.toMatchObject({
        stdout: expect.stringContaining('HTTP 401'),
      })

      const ok = await runScript(script, baseUrl, {
        MISSION_CONTROL_SERVICE_API_KEY: TEST_KEY,
      })
      expect(ok.stdout).toContain('No agents found with session keys configured')
    } finally {
      await mc.stop()
    }
  })
})
