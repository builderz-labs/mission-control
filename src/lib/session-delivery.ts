import { runOpenClaw } from './command'

/**
 * Deliver a session message via the openclaw gateway.
 *
 * Uses the documented OpenClaw API:
 *   openclaw gateway call sessions.send --params '{"session":"<key>","message":"<text>"}'
 *
 * Returns null on success or when session delivery is not supported on this
 * installation (gateway not running / "unknown method" / "unknown command").
 * Returns a non-empty error string only when the gateway is reachable but
 * the call definitively fails.
 *
 * Typical timings:
 *  - Success:                          < 500 ms
 *  - Gateway "unknown method" (no-op): < 500 ms (short-circuit, resolves null)
 *  - Timeout / unreachable:            bounded by timeoutMs
 */
export function sendSessionMessage(
  sessionKey: string,
  message: string,
  timeoutMs = 5000
): Promise<string | null> {
  const payload = JSON.stringify({ session: sessionKey, message })

  return runOpenClaw(
    ['gateway', 'call', 'sessions.send', '--params', payload],
    { timeoutMs }
  )
    .then(() => null)
    .catch((e: any): string | null => {
      const detail = String(e?.stderr || e?.message || 'session delivery failed')
      // If the gateway definitively does not support this method, treat it as
      // a silent no-op — session delivery is simply not available on this
      // installation, which is an expected state.
      if (detail.includes('unknown method') || detail.includes('unknown command')) {
        return null
      }
      return detail
    })
}
