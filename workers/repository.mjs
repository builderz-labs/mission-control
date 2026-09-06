import { withGitAuth } from './git-auth.mjs'
import { retry } from './process.mjs'

export async function checkoutRepository(job, run, cwd) {
  const options = { cwd }
  await run('git', ['init', '--quiet'], options)
  await run('git', ['remote', 'add', 'origin', job.repository], options)
  await withGitAuth(job.repository, env => retry(run, 'git', ['-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=30', 'fetch', '--depth', '1', 'origin', job.base_sha], {
    cwd, env, timeoutMs: 120_000, label: 'Repository fetch',
  }))
  await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], options)
  const sha = await run('git', ['rev-parse', 'HEAD'], options)
  if (sha !== job.base_sha) throw new Error('Fetched revision does not match the pinned SHA')
  await run('git', ['checkout', '--quiet', '-b', job.branch_name], options)
  await run('git', ['config', 'user.name', 'Mission Control Fly Worker'], options)
  await run('git', ['config', 'user.email', 'fly-worker@mission-control.local'], options)
}

export async function verifiedRevision(job, run, cwd) {
  const options = { cwd }
  const resultSha = await run('git', ['rev-parse', 'HEAD'], options)
  if (!/^[a-f0-9]{40}$/.test(resultSha)) throw new Error('Result revision is malformed')
  if (resultSha !== job.base_sha) throw new Error('Verification changed the pinned revision')
  return resultSha
}


