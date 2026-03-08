const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const httpProxy = require('http-proxy')

const port = parseInt(process.env.PORT || '3000', 10)
const app = next({ dev: false, hostname: '0.0.0.0', port })
const handle = app.getRequestHandler()

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1'
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || '18789'
const GATEWAY_WS_URL = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}`

const proxy = httpProxy.createProxyServer({
  target: GATEWAY_WS_URL,
  ws: true,
  changeOrigin: false,
})

proxy.on('error', (err, req, res) => {
  console.error('[ws-proxy] error:', err.message)
  try {
    if (res && res.writeHead && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Gateway unavailable')
    }
  } catch (_) {}
})

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || '/', true))
  })

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws-proxy')) {
      req.url = req.url.replace('/ws-proxy', '') || '/'
      proxy.ws(req, socket, head)
    } else {
      socket.destroy()
    }
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`> MC ready on http://0.0.0.0:${port}`)
    console.log(`> WS proxy: /ws-proxy → ${GATEWAY_WS_URL}`)
  })
})
