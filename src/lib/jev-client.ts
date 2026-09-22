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
import { isDeepStrictEqual } from 'node:util'

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
  signal?: AbortSignal
}

function probabilities(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const values = Object.values(value)
  return values.length > 0
    && values.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1)
    && Math.abs(values.reduce((sum, item) => sum + item, 0) - 1) <= 0.02
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function scoreMatchesDistribution(score: number, distribution: Record<string, number>): boolean {
  const expected = Object.entries(distribution)
    .reduce((total, [index, probability]) => total + Number(index) * probability, 0)
  return Math.abs(score - expected) <= 0.03
}

function validAnswer(question: Record<string, unknown>, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const answer = value as Record<string, unknown>
  if (question.type === 'noul') {
    return answer.type === 'noul' && typeof answer.noul === 'number'
      && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1
  }
  if (!probabilities(answer.probabilities) || typeof answer.confidence !== 'number'
    || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) return false
  if (question.type === 'choice') {
    const criteria = question.criteria as Record<string, unknown>
    const labels = Object.keys(criteria)
    return answer.type === 'choice' && typeof answer.choice === 'string'
      && Object.hasOwn(criteria, answer.choice)
      && exactKeys(answer.probabilities as Record<string, unknown>, labels)
  }
  if (question.type !== 'score' || answer.type !== 'score') return false
  const criteria = question.criteria
  if (!Array.isArray(criteria)) return false
  const indexes = criteria.map((_, index) => String(index))
  const legend = answer.legend
  const distribution = answer.probabilities as Record<string, number>
  return typeof answer.score === 'number' && Number.isFinite(answer.score)
    && answer.score >= 0 && answer.score <= criteria.length - 1
    && exactKeys(distribution, indexes)
    && scoreMatchesDistribution(answer.score, distribution)
    && legend !== null && typeof legend === 'object' && !Array.isArray(legend)
    && exactKeys(legend as Record<string, unknown>, indexes)
    && indexes.every((key, index) => isDeepStrictEqual((legend as Record<string, unknown>)[key], criteria[index]))
}

function validateResult(input: { questions: Questions }, data: Record<string, unknown>) {
  if (typeof data.model !== 'string' || !data.model || !data.answers || typeof data.answers !== 'object') {
    throw new JevClientError('JEV_INVALID_RESPONSE', 502)
  }
  const answers = data.answers as Record<string, unknown>
  const questionEntries = Object.entries(input.questions as unknown as Record<string, Record<string, unknown>>)
  if (Object.keys(answers).length !== questionEntries.length
    || !questionEntries.every(([id, question]) => validAnswer(question, answers[id]))) {
    throw new JevClientError('JEV_INVALID_RESPONSE', 502)
  }
  const usage = data.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined
  if (!usage || !Number.isInteger(usage.input_tokens) || Number(usage.input_tokens) < 0
    || !Number.isInteger(usage.output_tokens) || Number(usage.output_tokens) < 0) {
    throw new JevClientError('JEV_INVALID_RESPONSE', 502)
  }
  return { model: data.model, answers, usage: usage as { input_tokens: number; output_tokens: number } }
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
    const result = await createClient(options).systemOne(input, options.signal ? { signal: options.signal } : undefined).withResponse()
    const data = validateResult(input, result.data as unknown as Record<string, unknown>)
    return {
      ...data,
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
