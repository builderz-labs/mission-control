export const RESULT_RETENTION_SECONDS = 120

// expires_at bounds the whole Machine lease, including time to collect results.
export function workDeadline(job, startedAt = Date.now()) {
  const deadline = Math.min(startedAt + job.timeout_seconds * 1000,
    (job.expires_at - RESULT_RETENTION_SECONDS) * 1000)
  if (deadline <= startedAt) throw new Error('Job lease cannot cover result retention')
  return deadline
}

export async function retainResult(sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), expiresAt, now = Date.now()) {
  // Use the already-budgeted lease for recovery; successful collection destroys us early.
  const remaining = Number.isFinite(expiresAt) ? Math.max(0, expiresAt * 1000 - now) : RESULT_RETENTION_SECONDS * 1000
  await sleep(Math.min(2_100_000, remaining))
}

