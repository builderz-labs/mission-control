'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface TerminalViewProps {
  sessionId: string
  sessionKind: 'claude-code' | 'codex-cli' | 'hermes' | 'opencode' | 'gateway'
  mode: 'readonly' | 'interactive'
  onExit?: (code: number) => void
  onError?: (error: string) => void
  onReady?: () => void
}

type ConnectionState = 'connecting' | 'ready' | 'disconnected' | 'error' | 'unsupported'

export function TerminalView({ sessionId, sessionKind, mode, onExit, onError, onReady }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<any>(null)
  const [connState, setConnState] = useState<ConnectionState>('connecting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const connect = useCallback(async () => {
    if (!containerRef.current) return

    setConnState('connecting')
    setErrorMessage(null)

    // Step 1: Check PTY support via REST API
    try {
      const res = await fetch('/api/pty/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, kind: sessionKind, mode }),
      })
      const data = await res.json()

      if (!data.supported) {
        setConnState('unsupported')
        setErrorMessage(data.message || 'Terminal not supported for this session')
        onError?.(data.message || 'Terminal not supported')
        return
      }

      // Step 2: Load xterm.js dynamically (heavy dependency, client-only)
      const [xtermModule, fitModule, webLinksModule] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])

      // Inject xterm CSS inline (avoids module resolution issues with Next.js)
      if (!document.querySelector('style[data-xterm-css]')) {
        const style = document.createElement('style')
        style.setAttribute('data-xterm-css', '1')
        style.textContent = `
          .xterm { position: relative; user-select: none; }
          .xterm.focus, .xterm:focus { outline: none; }
          .xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
          .xterm .xterm-helper-textarea { padding: 0; border: 0; margin: 0; position: absolute; opacity: 0; left: -9999em; top: 0; width: 0; height: 0; z-index: -5; white-space: nowrap; overflow: hidden; resize: none; }
          .xterm .composition-view { display: none; position: absolute; white-space: nowrap; z-index: 1; }
          .xterm .xterm-viewport { background-color: transparent; overflow-y: scroll; cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0; }
          .xterm .xterm-screen { position: relative; }
          .xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
          .xterm .xterm-scroll-area { visibility: hidden; }
          .xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; top: 0; left: -9999em; line-height: normal; }
          .xterm.enable-mouse-events { cursor: default; }
          .xterm .xterm-cursor-pointer { cursor: pointer; }
          .xterm.column-select.focus { cursor: crosshair; }
          .xterm .xterm-accessibility:not(.debug), .xterm .xterm-message { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; pointer-events: none; }
          .xterm .xterm-decoration-container .xterm-decoration { z-index: 6; position: absolute; }
          .xterm .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer { z-index: 7; }
          .xterm .xterm-decoration-overview-ruler { z-index: 8; position: absolute; top: 0; right: 0; pointer-events: none; }
          .xterm .xterm-decoration-top { z-index: 2; position: relative; }
        `
        document.head.appendChild(style)
      }

      const Terminal = xtermModule.Terminal
      const FitAddon = fitModule.FitAddon
      const WebLinksAddon = webLinksModule.WebLinksAddon

      // Dispose previous terminal if re-connecting
      if (termRef.current) {
        termRef.current.dispose()
      }

      const term = new Terminal({
        cursorBlink: mode === 'interactive',
        cursorStyle: mode === 'interactive' ? 'bar' : 'underline',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        lineHeight: 1.3,
        scrollback: 5000,
        theme: {
          background: '#0a0a0f',
          foreground: '#e4e4e7',
          cursor: '#22d3ee',
          cursorAccent: '#0a0a0f',
          selectionBackground: '#3f3f4680',
          selectionForeground: '#e4e4e7',
          black: '#18181b',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#facc15',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e4e4e7',
          brightBlack: '#52525b',
          brightRed: '#fca5a5',
          brightGreen: '#86efac',
          brightYellow: '#fde68a',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#fafafa',
        },
        allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      const webLinksAddon = new WebLinksAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(webLinksAddon)

      termRef.current = term
      fitAddonRef.current = fitAddon

      term.open(containerRef.current)
      fitAddon.fit()
      term.scrollToBottom()

      // Step 3: Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${protocol}://${window.location.host}${data.wsPath}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        // Send initial size
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }))
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          switch (msg.type) {
            case 'output':
              term.write(msg.data)
              term.scrollToBottom()
              break
            case 'ready':
              setConnState('ready')
              onReady?.()
              break
            case 'exit':
              setConnState('disconnected')
              onExit?.(msg.code)
              break
            case 'error':
              setConnState('error')
              setErrorMessage(msg.message)
              onError?.(msg.message)
              break
          }
        } catch {
          // Raw text fallback
          term.write(event.data)
          term.scrollToBottom()
        }
      }

      ws.onclose = () => {
        if (connState !== 'error') {
          setConnState('disconnected')
        }
      }

      ws.onerror = () => {
        setConnState('error')
        setErrorMessage('WebSocket connection failed')
      }

      // Forward terminal input to WebSocket
      if (mode === 'interactive') {
        term.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data }))
          }
        })
      }

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit()
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            }))
          }
        } catch {
          // ignore
        }
      })
      resizeObserver.observe(containerRef.current)

      // Cleanup on unmount is handled by the effect cleanup
      return () => {
        resizeObserver.disconnect()
        ws.close()
        term.dispose()
      }
    } catch (err) {
      setConnState('error')
      const msg = err instanceof Error ? err.message : 'Failed to connect'
      setErrorMessage(msg)
      onError?.(msg)
    }
  }, [sessionId, sessionKind, mode, onExit, onError, onReady, connState])

  useEffect(() => {
    const cleanup = connect()
    return () => {
      cleanup?.then?.((fn) => fn?.())
      wsRef.current?.close()
      termRef.current?.dispose()
    }
  }, [connect])

  return (
    <div className="relative h-full w-full min-h-[200px] bg-[#0a0a0f] rounded-lg overflow-hidden">
      {/* Terminal container */}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ padding: '8px' }}
      />

      {/* Connection status overlay */}
      {connState === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f]/90 z-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Connecting to session...
          </div>
        </div>
      )}

      {connState === 'disconnected' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f]/90 z-10">
          <div className="flex flex-col items-center gap-3">
            <span className="text-sm text-muted-foreground">Session disconnected</span>
            <button
              type="button"
              onClick={() => connect()}
              className="px-3 py-1.5 text-xs rounded-md bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
            >
              Reconnect
            </button>
          </div>
        </div>
      )}

      {connState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f]/90 z-10">
          <div className="flex flex-col items-center gap-2 max-w-sm text-center">
            <span className="text-sm text-red-400">Connection error</span>
            <span className="text-xs text-muted-foreground">{errorMessage}</span>
            <button
              type="button"
              onClick={() => connect()}
              className="mt-2 px-3 py-1.5 text-xs rounded-md bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {connState === 'unsupported' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f]/90 z-10">
          <div className="flex flex-col items-center gap-2 max-w-sm text-center">
            <span className="text-sm text-amber-400">Terminal not available</span>
            <span className="text-xs text-muted-foreground">{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Mode indicator */}
      {connState === 'ready' && (
        <div className="absolute top-2 right-2 z-10">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            mode === 'interactive'
              ? 'bg-green-500/15 text-green-400 border border-green-500/25'
              : 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/25'
          }`}>
            {mode === 'interactive' ? 'INTERACTIVE' : 'READ-ONLY'}
          </span>
        </div>
      )}
    </div>
  )
}
