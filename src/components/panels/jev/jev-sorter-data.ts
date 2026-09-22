import type { JevEvaluation, JevPolicy, JevState } from './jev-ui-types'

export type RunScope = 'unsorted' | '25' | '100' | 'all'
export type DatasetFormat = 'text' | 'json' | 'dataset'
export interface SorterItem { hash: string; state: JevState }
export interface SorterRow { hash: string; evaluation: JevEvaluation }
export const RUN_SCOPES: Array<[RunScope, string]> = [
  ['unsorted', 'Anything not sorted yet'], ['25', 'Quick test: first 25'],
  ['100', 'First 100'], ['all', 'Redo everything'],
]

export function humanize(id: string): string {
  return id.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function parseDataset(text: string, format: DatasetFormat): JevState[] {
  if (!text.trim()) throw new Error('Add some evidence before preparing the dataset.')
  if (text.length > 200_000) throw new Error('Use a dataset smaller than 200,000 characters.')
  let parsed: unknown
  try { parsed = format === 'text' ? text : JSON.parse(text) }
  catch { throw new Error('This is not valid JSON. Check commas, quotes, and brackets.') }
  const rows = format === 'dataset' ? parsed : [parsed]
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) {
    throw new Error('Use a JSON array containing 1 to 100 items.')
  }
  const valid = (value: unknown, depth = 0): boolean => {
    if (depth > 30) return false
    if (!value || typeof value !== 'object') return true
    return Object.values(value).every((child) => valid(child, depth + 1))
  }
  if (rows.some((row) => row === null || (!Array.isArray(row) && typeof row !== 'object' && typeof row !== 'string')
    || (typeof row === 'string' && (!row.trim() || row.length > 100_000)) || !valid(row))) {
    throw new Error('Each item must be nonempty text, an object, or an array, with at most 30 nested levels.')
  }
  return rows as JevState[]
}

export async function fingerprintDataset(states: JevState[]): Promise<SorterItem[]> {
  const items = await Promise.all(states.map(async (state) => {
    const bytes = new TextEncoder().encode(typeof state === 'string' ? state : JSON.stringify(state))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return { hash, state }
  }))
  return [...new Map(items.map((item) => [item.hash, item])).values()]
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function savedRows(evaluations: JevEvaluation[], policy: JevPolicy): SorterRow[] {
  const rows = new Map<string, SorterRow>()
  for (const evaluation of [...evaluations].sort((a, b) => (b.completed_at ?? b.created_at) - (a.completed_at ?? a.created_at))) {
    if (evaluation.project_id !== policy.project_id || evaluation.policy_id !== policy.id
      || evaluation.status !== 'succeeded' || !evaluation.answers || evaluation.model_requested !== policy.model
      || canonical(evaluation.questions) !== canonical(policy.questions)) continue
    if (!rows.has(evaluation.state_sha256)) rows.set(evaluation.state_sha256, { hash: evaluation.state_sha256, evaluation })
  }
  return [...rows.values()]
}

export function runItems(items: SorterItem[], rows: SorterRow[], scope: RunScope): SorterItem[] {
  if (scope === 'unsorted') {
    const completed = new Set(rows.map((row) => row.hash))
    return items.filter((item) => !completed.has(item.hash))
  }
  return scope === 'all' ? items : items.slice(0, Number(scope))
}

export function answerBucket(answer: unknown, question: JevPolicy['questions'][string], threshold = 0.5): string | null {
  if (!answer || typeof answer !== 'object') return null
  const value = answer as Record<string, unknown>
  if (value.type !== question.type) return null
  if (question.type === 'noul' && typeof value.noul === 'number' && Number.isFinite(value.noul)
    && value.noul >= 0 && value.noul <= 1) return value.noul >= threshold ? 'Yes' : 'No'
  if (question.type === 'choice' && typeof value.choice === 'string'
    && Object.hasOwn(question.criteria, value.choice)) return value.choice
  if (question.type === 'score' && Array.isArray(question.criteria) && typeof value.score === 'number' && Number.isFinite(value.score)
    && value.score >= 0 && value.score <= question.criteria.length - 1) return String(Math.round(value.score))
  return null
}

export function summarizeQuestion(question: JevPolicy['questions'][string], id: string, rows: SorterRow[], threshold = 0.5) {
  const levels = question.type === 'score' && Array.isArray(question.criteria) ? question.criteria : []
  const buckets = question.type === 'noul' ? ['Yes', 'No'] : question.type === 'choice'
    ? Object.keys(question.criteria) : levels.map((_, index) => String(index))
  const counts = new Map(buckets.map((bucket) => [bucket, 0]))
  let total = 0; let scoreSum = 0
  for (const row of rows) {
    const answer = row.evaluation.answers?.[id]
    const bucket = answerBucket(answer, question, threshold)
    if (bucket === null) continue
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1); total += 1
    if (question.type === 'score') scoreSum += (answer as { score: number }).score + 1
  }
  return { total, average: question.type === 'score' && total ? scoreSum / total : null,
    buckets: buckets.map((key) => ({ key, count: counts.get(key) ?? 0, label: question.type === 'score'
      ? `${Number(key) + 1}. ${typeof levels[Number(key)] === 'string' ? levels[Number(key)] : JSON.stringify(levels[Number(key)])}`
      : humanize(key) })) }
}
