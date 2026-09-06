import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { cleanEnvironment, retry } from './process.mjs'

function gitEnvironment() {
  const env = cleanEnvironment()
  if (process.env.MC_FLY_GIT_AUTH_TOKEN) {
    env.MC_FLY_GIT_AUTH_TOKEN = process.env.MC_FLY_GIT_AUTH_TOKEN
    env.GIT_ASKPASS = `node ${fileURLToPath(new URL('./git-askpass.mjs', import.meta.url))}`
  }
  return env
}

export async function checkoutRepository(job, run, cwd) {
  const options = { cwd }
  await run('git', ['init', '--quiet'], options)
  await run('git', ['remote', 'add', 'origin', job.repository], options)
  await retry(run, 'git', ['-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=30', 'fetch', '--depth', '1', 'origin', job.base_sha], {
    cwd, env: gitEnvironment(), timeoutMs: 120_000, label: 'Repository fetch',
  })
  await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], options)
  const sha = await run('git', ['rev-parse', 'HEAD'], options)
  if (sha !== job.base_sha) throw new Error('Fetched revision does not match the pinned SHA')
  await run('git', ['checkout', '--quiet', '-b', job.branch_name], options)
  await run('git', ['config', 'user.name', 'Mission Control Fly Worker'], options)
  await run('git', ['config', 'user.email', 'fly-worker@mission-control.local'], options)
  return readFile(path.join(cwd, '.git/config'), 'utf8')
}

export async function publishResult(job, run, cwd, originalConfig) {
  const options = { cwd }
  if (job.runtime !== 'command') {
    if (await readFile(path.join(cwd, '.git/config'), 'utf8') !== originalConfig) throw new Error('Agent changed repository configuration')
    const branch = await run('git', ['branch', '--show-current'], options)
    if (branch !== job.branch_name) throw new Error('Agent changed the isolated branch')
    const remote = await run('git', ['remote', 'get-url', 'origin'], options)
    if (remote !== job.repository) throw new Error('Agent changed the approved repository')
    await run('git', ['merge-base', '--is-ancestor', job.base_sha, 'HEAD'], { ...options, label: 'Result revision ancestry' })
    await run('git', ['add', '-A'], options)
    const changed = await run('git', ['diff', '--cached', '--name-only'], options)
    if (changed) await run('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `feat: complete Mission Control task ${job.id.slice(0, 8)}`], options)
    await retry(run, 'git', ['-c', 'core.hooksPath=/dev/null', '-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=30', 'push', job.repository, `HEAD:refs/heads/${job.branch_name}`], {
      cwd, env: gitEnvironment(), timeoutMs: 120_000, label: 'Result branch push',
    })
  }
  const resultSha = await run('git', ['rev-parse', 'HEAD'], options)
  if (!/^[a-f0-9]{40}$/.test(resultSha)) throw new Error('Result revision is malformed')
  if (job.runtime === 'command' && resultSha !== job.base_sha) throw new Error('Verification changed the pinned revision')
  return resultSha
}


