import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

const mocks = vi.hoisted(() => ({
  port: 19876,
  requestFrames: [] as any[],
}))

vi.mock('@/lib/config', () => ({
  config: {
    gatewayHost: '127.0.0.1',
    gatewayPort: mocks.port,
  },
}))

vi.mock('@/lib/gateway-runtime', () => ({
  getDetectedGatewayToken: () => 'test-token',
}))

import { callOpenClawGateway, parseGatewayJsonOutput } from '@/lib/openclaw-gateway'

let server: WebSocketServer

beforeAll(async () => {
  server = new WebSocketServer({ host: '127.0.0.1', port: mocks.port })
  server.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-1' },
    }))

    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString())
      if (frame.method === 'connect') {
        ws.send(JSON.stringify({
          type: 'res',
          id: frame.id,
          ok: true,
          result: { protocol: 3 },
        }))
        return
      }

      mocks.requestFrames.push(frame)
      ws.send(JSON.stringify({
        type: 'res',
        id: frame.id,
        ok: true,
        result: { ok: true, echo: frame.params, expectFinal: frame.expectFinal === true },
      }))
    })
  })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('parseGatewayJsonOutput', () => {
  it('parses embedded object payloads', () => {
    expect(parseGatewayJsonOutput('warn\n{"status":"started","runId":"abc"}\n')).toEqual({
      status: 'started',
      runId: 'abc',
    })
  })

  it('parses embedded array payloads', () => {
    expect(parseGatewayJsonOutput('note\n[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('returns null for non-json output', () => {
    expect(parseGatewayJsonOutput('plain text only')).toBeNull()
  })
})

describe('callOpenClawGateway', () => {
  beforeEach(() => {
    mocks.requestFrames = []
  })

  it('sends params over the programmatic websocket RPC path', async () => {
    const result = await callOpenClawGateway(
      'agent',
      { message: 'hello', deliver: false },
      5000,
      { expectFinal: true },
    )

    expect(result).toEqual({
      ok: true,
      expectFinal: true,
      echo: {
        message: 'hello',
        deliver: false,
      },
    })
    expect(mocks.requestFrames).toHaveLength(1)
    expect(mocks.requestFrames[0]).toMatchObject({
      type: 'req',
      method: 'agent',
      expectFinal: true,
      params: {
        message: 'hello',
        deliver: false,
      },
    })
  })

  it('rejects gateway RPC errors', async () => {
    server.once('connection', (ws) => {
      ws.removeAllListeners('message')
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString())
        if (frame.method === 'connect') {
          ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, result: {} }))
        } else {
          ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { message: 'boom' } }))
        }
      })
    })

    await expect(callOpenClawGateway('agent', {
      message: 'hello',
      deliver: false,
    }, 5000)).rejects.toThrow('boom')
  })
})
