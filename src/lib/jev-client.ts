import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
  VERSION,
  type EntryType,
  type Fetch,
  type ModelCard,
  type Questions,
} from '@typesafe-ai/sdk'

export const JEV_SDK_VERSION = VERSION
export const JEV_DEFAULT_MODEL = 'jev-latest'

export class JevClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(code)
    this.name = 'JevClientError'
  }
}

interface JevClientOptions {
  apiKey?: string
  fetch?: Fetch
}

function createClient(options: JevClientOptions = {}): TypeSafeClient {
  const apiKey = (options.apiKey ?? process.env.TYPESAFE_API_KEY ?? '').trim()
  if (!apiKey) throw new JevClientError('JEV_NOT_CONFIGURED', 503)
  return new TypeSafeClient({
    apiKey,
    fetch: options.fetch,
    timeout: 10_000,
    retry: { maxRetries: 1 },
    logLevel: 'off',
  })
}

function safeError(error: unknown): JevClientError {
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return new JevClientError('JEV_CREDENTIAL_REJECTED', 502, error.requestId)
    }
    if (error.status === 422) return new JevClientError('JEV_REQUEST_REJECTED', 422, error.requestId)
    if (error.status === 429) return new JevClientError('JEV_RATE_LIMITED', 429, error.requestId)
    return new JevClientError('JEV_UPSTREAM_ERROR', 502, error.requestId)
  }
  if (error instanceof APITimeoutError) return new JevClientError('JEV_TIMEOUT', 504)
  if (error instanceof APIUserAbortError) return new JevClientError('JEV_CANCELLED', 499)
  if (error instanceof APIConnectionError) return new JevClientError('JEV_UNAVAILABLE', 503)
  if (error instanceof JevClientError) return error
  return new JevClientError('JEV_UNEXPECTED_ERROR', 502)
}

export async function evaluateWithJev(
  input: { state: EntryType; questions: Questions; model: string },
  options: JevClientOptions = {},
) {
  try {
    const result = await createClient(options).systemOne(input).withResponse()
    return {
      model: result.data.model,
      answers: result.data.answers as Record<string, unknown>,
      usage: result.data.usage,
      requestId: result.requestId ?? null,
    }
  } catch (error) {
    throw safeError(error)
  }
}

export async function listJevModels(options: JevClientOptions = {}): Promise<ModelCard[]> {
  try {
    return await createClient(options).models.list()
  } catch (error) {
    throw safeError(error)
  }
}
