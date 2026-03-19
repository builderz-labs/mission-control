export interface FetchSetupStatusOptions {
  attempts?: number
  timeoutMs?: number
}

export interface SetupStatusResponse {
  needsSetup: boolean
}

/**
 * Fetch setup status with timeout + bounded retries.
 */
export async function fetchSetupStatusWithRetry(
  fetchFn: typeof fetch,
  options: FetchSetupStatusOptions = {}
): Promise<SetupStatusResponse> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 5000)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs)

    try {
      const res = await fetchFn('/api/setup', { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Setup status check failed (${res.status})`)
      }
      const data = await res.json() as SetupStatusResponse
      if (typeof data?.needsSetup !== 'boolean') {
        throw new Error('Invalid setup status response')
      }
      return data
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        lastError = new Error('Setup status request timed out')
      } else {
        lastError = error instanceof Error ? error : new Error('Setup status request failed')
      }

      if (attempt < attempts) {
        // tiny backoff to avoid immediate hammering during transient stalls
        await new Promise(resolve => setTimeout(resolve, 250 * attempt))
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw (lastError ?? new Error('Failed to check setup status'))
}
