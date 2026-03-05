import { runClawdbot, runOpenClaw } from './command'

/**
 * Try to deliver a session message via clawdbot and openclaw gateway in parallel.
 * Returns null on success, or a non-empty error string if both methods fail.
 *
 * Both methods are fired simultaneously.  The first to succeed resolves null.
 * If the gateway immediately reports a definitive "not supported" error
 * ("unknown method" or "unknown command"), we short-circuit and resolve with
 * the failure immediately — we do NOT wait for the pending clawdbot call to
 * reach its timeout, because that error means session delivery is simply
 * not available on this installation.  The clawdbot process continues running
 * in the background but will be killed by its own timeout without affecting
 * the HTTP response latency.
 *
 * Typical timings:
 *  - Success via either method:        < 500 ms
 *  - Gateway "unknown method" failure: < 500 ms (short-circuit, no clawdbot wait)
 *  - Both genuinely unavailable:       bounded by timeoutMs (both time out)
 */
export function sendSessionMessage(
  sessionKey: string,
  message: string,
  timeoutMs = 5000
): Promise<string | null> {
  const payload = JSON.stringify({ session: sessionKey, message })

  return new Promise<string | null>((resolve) => {
    let done = false
    const finish = (result: string | null) => {
      if (!done) {
        done = true
        resolve(result)
      }
    }

    let cbError: string | null = null
    let cbDone = false
    let gwError: string | null = null
    let gwDone = false

    const checkBothFailed = () => {
      if (cbDone && gwDone) {
        // At least one must have an error for us to reach here (otherwise
        // finish(null) would have been called on success).
        finish(
          [cbError, gwError].filter(Boolean).join('; ') ||
          'session delivery failed'
        )
      }
    }

    // clawdbot attempt
    runClawdbot(['sessions_send', sessionKey, message], { timeoutMs })
      .then(() => finish(null))
      .catch((e: any) => {
        cbError = String(e?.message || 'clawdbot failed')
        cbDone = true
        checkBothFailed()
      })

    // Gateway RPC attempt
    runOpenClaw(
      ['gateway', 'call', 'sessions.send', '--params', payload],
      { timeoutMs }
    )
      .then(() => finish(null))
      .catch((e: any) => {
        const detail = String(e?.stderr || e?.message || 'gateway failed')
        gwError = detail
        gwDone = true
        // If gateway gives a definitive "not supported" error, do not wait for
        // the clawdbot timeout — session delivery is not available on this
        // installation.  Mark clawdbot as done so checkBothFailed() can resolve.
        if (detail.includes('unknown method') || detail.includes('unknown command')) {
          cbDone = true
          cbError = 'skipped (gateway indicates session delivery not supported)'
        }
        checkBothFailed()
      })
  })
}
