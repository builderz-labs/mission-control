import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Terminal attachment client security contract', () => {
  it('secures the privileged handshake and keeps connection state out of callback dependencies', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/terminal/terminal-view.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(1)
    expect(source).not.toMatch(/fetch\([`'"]\/api\/pty\/attach/)
    expect(source).toContain(
      "apiFetch<PtyAttachResponse>('/api/pty/attach'",
    )
    expect(source).toContain("/^\\/ws\\/pty(?:\\?|$)/.test(data.wsPath)")
    expect(source).toContain("throw new Error('Terminal endpoint was invalid')")
    expect(source).toContain(
      "setConnState(current => current === 'error' ? current : 'disconnected')",
    )
    expect(source).toContain(
      '}, [sessionId, sessionKind, mode, onExit, onError, onReady])',
    )
    expect(source).not.toContain(
      '}, [sessionId, sessionKind, mode, onExit, onError, onReady, connState])',
    )
  })
})
