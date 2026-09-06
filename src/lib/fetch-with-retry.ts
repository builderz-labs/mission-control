export type RetryableRequestInit = RequestInit

interface FetchRetryPolicy {
  attempts?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 5_000

function requestSignal(
  existing: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): AbortSignal {
  if (existing && timeoutMs === undefined) return existing
  const timeout = AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return existing ? AbortSignal.any([existing, timeout]) : timeout
}

function shouldRetry(response: Response): boolean {
  return response.status === 429 || response.status >= 500
}

export async function fetchWithRetry(
  input: string | URL,
  init: RetryableRequestInit = {},
  policy: FetchRetryPolicy = {},
): Promise<Response> {
  const attempts = Math.max(1, policy.attempts ?? 2)
  const timeoutMs = policy.timeoutMs === undefined
    ? undefined
    : Math.max(1, policy.timeoutMs)
  const fetchImpl = policy.fetchImpl ?? fetch
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: requestSignal(init.signal, timeoutMs),
      })
      if (!shouldRetry(response) || attempt === attempts - 1) return response
      await response.body?.cancel().catch(() => undefined)
      lastError = new Error(`Remote service returned ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) throw error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Remote request failed')
}
