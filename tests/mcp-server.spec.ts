import { expect, test } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { createTestAgent, deleteTestAgent, createTestTask, deleteTestTask } from './helpers'

const MCP = path.resolve('scripts/mc-mcp-server.cjs')
const PACKAGE_VERSION = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).version
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3005'
const API_KEY = 'test-api-key-e2e-12345'

/** Send JSON-RPC messages to the MCP server and collect responses */
async function mcpCall(messages: object[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [MCP], {
      env: { ...process.env, MC_URL: BASE_URL, MC_API_KEY: API_KEY },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })

    let stderr = ''
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    // Write all messages
    for (const msg of messages) {
      child.stdin.write(JSON.stringify(msg) + '\n')
    }
    child.stdin.end()

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`MCP server timeout. stdout: ${stdout}, stderr: ${stderr}`))
    }, 15000)

    child.on('close', () => {
      clearTimeout(timer)
      const responses = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try { return JSON.parse(line) } catch { return { raw: line } }
        })
      resolve(responses)
    })
  })
}

/** Send a single MCP JSON-RPC request and return the response */
async function mcpRequest(method: string, params: object = {}, id = 1): Promise<any> {
  const responses = await mcpCall([
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1.0' }, capabilities: {} } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id, method, params },
  ])
  // Return the response matching our request id (skip initialize response)
  return responses.find(r => r.id === id) || responses[responses.length - 1]
}

/** Call an MCP tool and return the parsed content */
async function mcpTool(name: string, args: object = {}): Promise<{ content: any; isError?: boolean }> {
  const response = await mcpRequest('tools/call', { name, arguments: args }, 99)
  const text = response?.result?.content?.[0]?.text || ''
  let parsed: any
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return {
    content: parsed,
    isError: response?.result?.isError || false,
  }
}

test.describe('MCP Server Integration', () => {
  // --- Protocol ---

  test('initialize returns server info and capabilities', async () => {
    const responses = await mcpCall([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1.0' }, capabilities: {} } },
    ])
    expect(responses).toHaveLength(1)
    expect(responses[0].result.serverInfo.name).toBe('mission-control')
    expect(responses[0].result.serverInfo.version).toBe(PACKAGE_VERSION)
    expect(responses[0].result.capabilities.tools).toBeDefined()
  })

  test('tools/list returns all tools with schemas', async () => {
    const response = await mcpRequest('tools/list')
    const tools = response.result.tools
    expect(tools.length).toBeGreaterThan(30)

    // Every tool should have name, description, and inputSchema
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }

    // Check key tools exist
    const names = tools.map((t: any) => t.name)
    expect(names).toContain('mc_list_agents')
    expect(names).toContain('mc_poll_task_queue')
    expect(names).toContain('mc_heartbeat')
    expect(names).toContain('mc_read_memory')
    expect(names).toContain('mc_write_memory')
    expect(names).toContain('mc_add_comment')
    expect(names).toContain('mc_health')
  })

  test('unknown tool returns isError', async () => {
    const result = await mcpTool('mc_nonexistent', {})
    expect(result.isError).toBe(true)
  })

  test('ping responds', async () => {
    const response = await mcpRequest('ping')
    expect(response.result).toBeDefined()
  })

  test('unknown method returns error code', async () => {
    const response = await mcpRequest('foo/bar')
    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32601)
  })

  // --- Status tools ---

  test('mc_health returns status', async () => {
    const { content, isError } = await mcpTool('mc_health')
    expect(isError).toBe(false)
    expect(content).toBeDefined()
  })

  test('mc_dashboard returns system summary', async () => {
    const { content, isError } = await mcpTool('mc_dashboard')
    expect(isError).toBe(false)
  })

  // --- Agent tools ---

  test.describe('agent tools', () => {
    const agentIds: number[] = []

    test.afterEach(async ({ request }) => {
      for (const id of agentIds.splice(0)) {
        await deleteTestAgent(request, id).catch(() => {})
      }
    })

    test('mc_list_agents returns agents', async () => {
      const { content, isError } = await mcpTool('mc_list_agents')
      expect(isError).toBe(false)
    })

    test('mc_heartbeat sends heartbeat', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      const { isError } = await mcpTool('mc_heartbeat', { id: agent.id })
      expect(isError).toBe(false)
    })

    test('mc_write_memory writes and mc_read_memory reads', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      // Write
      const { isError: writeErr } = await mcpTool('mc_write_memory', {
        id: agent.id,
        working_memory: 'MCP test memory content',
      })
      expect(writeErr).toBe(false)

      // Read back
      const { isError: readErr } = await mcpTool('mc_read_memory', { id: agent.id })
      expect(readErr).toBe(false)
    })

    test('mc_clear_memory clears', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      const { isError } = await mcpTool('mc_clear_memory', { id: agent.id })
      expect(isError).toBe(false)
    })
  })

  // --- Task tools ---

  test.describe('task tools', () => {
    const taskIds: number[] = []

    test.afterEach(async ({ request }) => {
      for (const id of taskIds.splice(0)) {
        await deleteTestTask(request, id).catch(() => {})
      }
    })

    test('mc_list_tasks returns tasks', async () => {
      const { isError } = await mcpTool('mc_list_tasks')
      expect(isError).toBe(false)
    })

    test('mc_poll_task_queue returns response', async () => {
      const { isError } = await mcpTool('mc_poll_task_queue', { agent: 'e2e-mcp-agent' })
      expect(isError).toBe(false)
    })

    test('mc_create_task creates a task', async ({ request }) => {
      const { content, isError } = await mcpTool('mc_create_task', { title: 'MCP e2e test task' })
      expect(isError).toBe(false)
      if ((content as any)?.task?.id) taskIds.push((content as any).task.id)
    })

    test('mc_add_comment succeeds', async ({ request }) => {
      const task = await createTestTask(request)
      taskIds.push(task.id)

      const { isError } = await mcpTool('mc_add_comment', {
        id: task.id,
        content: 'MCP comment test',
      })
      expect(isError).toBe(false)
    })

    test('mc_list_comments returns array', async ({ request }) => {
      const task = await createTestTask(request)
      taskIds.push(task.id)

      const { isError } = await mcpTool('mc_list_comments', { id: task.id })
      expect(isError).toBe(false)
    })
  })

  // --- Token tools ---

  test('mc_token_stats returns stats', async () => {
    const { isError } = await mcpTool('mc_token_stats', { timeframe: 'all' })
    expect(isError).toBe(false)
  })

  // --- Skill tools ---

  test('mc_list_skills returns data', async () => {
    const { isError } = await mcpTool('mc_list_skills')
    expect(isError).toBe(false)
  })

  // --- Cron tools ---

  test('mc_list_cron returns data', async () => {
    const { isError } = await mcpTool('mc_list_cron')
    expect(isError).toBe(false)
  })
})
