export type LoginRequestBody =
  | { username: string; password: string }
  | { credential?: string }

/** Bound both headers and body reading. Never automatically replay a sign-in POST. */
export async function requestLogin(path: string, body: LoginRequestBody) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data: unknown = response.ok ? null : await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error
      return null
    })
    return { ok: response.ok, data }
  } finally {
    clearTimeout(timer)
  }
}
