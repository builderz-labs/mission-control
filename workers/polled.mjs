import { clearGitCredentials } from './git-auth.mjs'
import { mkdtemp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadJob } from './job.mjs'
import { createRunner } from './process.mjs'
import { createStateWriter } from './state.mjs'
import { checkoutRepository, publishResult } from './repository.mjs'
import { runAgent, setupRepository, verifyChecks } from './runtime.mjs'
import { retainResult, workDeadline } from './lifecycle.mjs'

export async function executeJob(job, dependencies = {}) {
  const deadline = workDeadline(job)
  const run = dependencies.run || createRunner(deadline)
  const write = dependencies.write || createStateWriter()
  const cwd = dependencies.cwd || await mkdtemp('/tmp/mc-worker-repo.')
  let state = { job_id: job.id, state: 'running', branch_name: job.branch_name, result_sha: null,
    resolution: null, error_message: null }
  await write(state)
  const heartbeat = setInterval(() => { void write(state).catch(() => run.stop?.()) }, 5_000)
  const watchdog = setTimeout(() => run.stop?.(), Math.max(1, deadline - Date.now()))
  try {
    const originalConfig = await checkoutRepository(job, run, cwd)
    // Approved command-only jobs never push. Drop the read-only clone credential
    // before package code; this reduces accidental inheritance, not same-UID access.
    if (job.runtime === 'command') clearGitCredentials()
    await setupRepository(job, run, cwd)
    await runAgent(job, run, cwd)
    await verifyChecks(job, run, cwd)
    const resultSha = await publishResult(job, run, cwd, originalConfig)
    if (Date.now() >= deadline) throw new Error('Job deadline exceeded')
    state = { ...state, state: 'succeeded', result_sha: resultSha,
      resolution: `${job.checks.join(', ')} passed at ${resultSha}; ${job.runtime === 'command' ? 'verification only, no branch pushed' : `result branch ${job.branch_name} pushed`}` }
  } catch (error) {
    state = { ...state, state: 'failed', error_message: error instanceof Error ? error.message.slice(0, 500) : 'Worker failed' }
  } finally {
    clearInterval(heartbeat); clearTimeout(watchdog); run.stop?.()
    if (job.runtime === 'command') clearGitCredentials()
    await write(state)
  }
  return state
}

async function main() {
  const write = createStateWriter()
  let job
  try {
    job = await loadJob()
    await executeJob(job, { write })
  } catch {
    await write({ job_id: job?.id || 'invalid', state: 'failed', branch_name: null, result_sha: null,
      resolution: null, error_message: 'Invalid job document or worker initialization failed' })
  }
  // The control plane polls this file over Machines exec and destroys the Machine.
  // This bound lets an unattended terminal worker exit and auto-destroy itself.
  await retainResult(undefined, job?.expires_at)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('Worker state could not be persisted\n'); process.exitCode = 1 })
}

