import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3333', 10)

const gatewayHost = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1'
const gatewayPort = process.env.OPENCLAW_GATEWAY_PORT || '18789'
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || ''
const gatewayUrl = `ws://${gatewayHost}:${gatewayPort}`

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url, true)

    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        // Connect to gateway — pass token as header (how openclaw expects it)
        const gwWs = new WebSocket(gatewayUrl, {
          headers: gatewayToken ? { 'Authorization': `Bearer ${gatewayToken}` } : {}
        })

        let gwReady = false

        gwWs.on('open', () => {
          console.log('[ws-proxy] Connected to gateway')
          gwReady = true
        })

        // Log first few messages for debugging
        let msgCount = 0

        clientWs.on('message', (data, isBinary) => {
          if (msgCount < 3) {
            console.log('[ws-proxy] Client→GW:', data.toString().slice(0, 200))
            msgCount++
          }
          if (gwWs.readyState === WebSocket.OPEN) {
            gwWs.send(data, { binary: isBinary })
          }
        })

        gwWs.on('message', (data, isBinary) => {
          if (msgCount < 6) {
            console.log('[ws-proxy] GW→Client:', data.toString().slice(0, 200))
            msgCount++
          }
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary })
          }
        })

        clientWs.on('close', () => { gwWs.close() })
        gwWs.on('close', (code, reason) => {
          console.log(`[ws-proxy] GW closed: ${code} ${reason}`)
          clientWs.close()
        })
        clientWs.on('error', (e) => { console.error('[ws-proxy] Client err:', e.message); gwWs.close() })
        gwWs.on('error', (e) => { console.error('[ws-proxy] GW err:', e.message); clientWs.close() })
      })
    }
  })

  server.listen(port, hostname, () => {
    console.log(`> Mission Control ready on http://${hostname}:${port}`)
    console.log(`> WebSocket proxy: /ws → ${gatewayUrl} (token: ${gatewayToken ? 'yes' : 'no'})`)
  })
})
