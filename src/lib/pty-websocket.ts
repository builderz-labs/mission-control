/**
 * PTY WebSocket handler — bridges browser xterm.js to server-side PTY
 *
 * Handles WebSocket upgrade on /ws/pty path.
 * Protocol: JSON messages for control, raw terminal data in output messages.
 */

import { type IncomingMessage } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { createPtySession, getPtySession } from './pty-manager'
import { requireRole } from '@/lib/auth'
import { logger } from './logger'

const log = logger.child({ module: 'pty-websocket' })

const SUPPORTED_KINDS = new Set(['claude-code', 'codex-cli'])
const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

let wss: WebSocketServer | null = null

type UpgradeValidationResult =
  | { ok: true; sessionId: string; kind: string; mode: 'readonly' | 'interactive' }
  | { ok: false; status: 400; message: string }

function validateUpgradeRequest(url: URL): UpgradeValidationResult {
  const sessionId = (url.searchParams.get('session') || '').trim()
  const kind = (url.searchParams.get('kind') || '').trim()
  const mode = (url.searchParams.get('mode') || 'readonly').trim()

  if (!sessionId) {
    return { ok: false, status: 400, message: 'session query param is required' }
  }
  if (!SESSION_ID_RE.test(sessionId)) {
    return { ok: false, status: 400, message: 'invalid session id' }
  }

  if (!kind || !SUPPORTED_KINDS.has(kind)) {
    return { ok: false, status: 400, message: `unsupported kind: ${kind || 'missing'}` }
  }

  if (mode !== 'readonly' && mode !== 'interactive') {
    return { ok: false, status: 400, message: 'mode must be "readonly" or "interactive"' }
  }

  return { ok: true, sessionId, kind, mode }
}

function toRequest(req: IncomingMessage): Request {
  const host = req.headers.host || 'localhost'
  const url = new URL(req.url || '/', `http://${host}`).toString()
  const headers = new Headers()

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '))
    } else if (typeof value === 'string') {
      headers.set(key, value)
    }
  }

  return new Request(url, {
    method: req.method || 'GET',
    headers,
  })
}

function writeWsHttpError(socket: any, status: number, message: string): void {
  const statusText = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Bad Request'
  const body = JSON.stringify({ error: message })
  const response = [
    `HTTP/1.1 ${status} ${statusText}`,
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n')

  try {
    socket.write(response)
  } catch {
    // ignore socket write errors
  }
  try {
    socket.destroy()
  } catch {
    // ignore socket destroy errors
  }
}

/** Initialize the WebSocket server (call once from custom server wrapper) */
export function initPtyWebSocket(): WebSocketServer {
  if (wss) return wss

  wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const parsed = validateUpgradeRequest(url)
    if (!parsed.ok) {
      log.warn({ reason: parsed.message }, 'Invalid PTY connection params; closing socket')
      ws.send(JSON.stringify({ type: 'error', message: parsed.message }))
      ws.close()
      return
    }

    const { sessionId, kind, mode } = parsed
    const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    log.info({ sessionId, kind, mode, clientId }, 'PTY WebSocket connected')

    let ptyId: string | null = null

    // Create or attach to PTY session
    createPtySession(sessionId, kind, mode)
      .then((ptySession) => {
        ptyId = ptySession.id

        ptySession.addClient({
          id: clientId,
          send: (data: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data)
            }
          },
          close: () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close()
            }
          },
        })

        // Send ready message
        ws.send(JSON.stringify({
          type: 'ready',
          ptyId: ptySession.id,
          sessionId,
          kind,
          mode,
        }))
      })
      .catch((error) => {
        log.error({ err: error, sessionId, kind }, 'Failed to create PTY session')
        ws.send(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to create PTY session',
        }))
        ws.close()
      })

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'))

        if (!ptyId) return

        const session = getPtySession(ptyId)
        if (!session) return

        switch (msg.type) {
          case 'input':
            session.write(msg.data || '')
            break
          case 'resize':
            if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
              session.resize(msg.cols, msg.rows)
            }
            break
          default:
            break
        }
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      log.info({ clientId, ptyId }, 'PTY WebSocket disconnected')
      if (ptyId) {
        const session = getPtySession(ptyId)
        session?.removeClient(clientId)
      }
    })

    ws.on('error', (err) => {
      log.error({ err, clientId }, 'PTY WebSocket error')
    })
  })

  return wss
}

/** Handle an HTTP upgrade request for PTY WebSocket */
export function handlePtyUpgrade(req: IncomingMessage, socket: any, head: Buffer): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname !== '/ws/pty') return false

  const parsed = validateUpgradeRequest(url)
  if (!parsed.ok) {
    log.warn({ reason: parsed.message, remote: req.socket?.remoteAddress }, 'Rejected PTY upgrade: invalid query params')
    writeWsHttpError(socket, parsed.status, parsed.message)
    return true
  }

  const minRole = parsed.mode === 'interactive' ? 'operator' : 'viewer'
  const auth = requireRole(toRequest(req), minRole)
  if ('error' in auth) {
    const status = auth.status || 401
    const message = auth.error || 'Authentication required'
    log.warn({ reason: message, status, minRole }, 'Rejected PTY upgrade: auth failed')
    writeWsHttpError(socket, status, message)
    return true
  }

  if (!wss) {
    initPtyWebSocket()
  }

  wss!.handleUpgrade(req, socket, head, (ws) => {
    wss!.emit('connection', ws, req)
  })

  return true
}
