import { fetchWithRetry } from '@/lib/fetch-with-retry'

const TYPESAFE_SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone'

interface TypeSafeProbeResult {
  readonly ok: boolean
  readonly detail: string
}

function hasProbeAnswer(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const answers = (value as { answers?: unknown }).answers
  if (typeof answers !== 'object' || answers === null) return false
  const connectivity = (answers as { connectivity?: unknown }).connectivity
  if (typeof connectivity !== 'object' || connectivity === null) return false
  const answer = connectivity as { type?: unknown; noul?: unknown }
  return answer.type === 'noul' && typeof answer.noul === 'number'
}

export async function probeTypeSafeApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TypeSafeProbeResult> {
  if (!apiKey.trim()) return { ok: false, detail: 'API key not set' }

  const response = await fetchWithRetry(TYPESAFE_SYSTEM_ONE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      state: 'Mission Control synthetic connectivity check.',
      model: 'jev-latest',
      questions: {
        connectivity: {
          type: 'noul',
          instructions: 'Is this a synthetic connectivity check?',
        },
      },
    }),
  }, {
    attempts: 2,
    timeoutMs: 10_000,
    fetchImpl,
    retryNonIdempotent: true,
  })

  if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` }
  const body: unknown = await response.json()
  return hasProbeAnswer(body)
    ? { ok: true, detail: 'API key valid' }
    : { ok: false, detail: 'Unexpected response' }
}
