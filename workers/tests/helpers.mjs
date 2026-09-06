import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRunner } from '../process.mjs'

export function job(overrides = {}) {
  return { id: 'abcdef123456abcdef123456abcdef12', title: 'Verify pinned repository', description: 'Run the approved checks',
    repository: 'https://github.com/example/repository.git', base_sha: 'a'.repeat(40),
    branch_name: 'mc/fly-task-12-abcd1234', runtime: 'command', setup: 'none', checks: ['smoke'],
    timeout_seconds: 30, expires_at: Math.floor(Date.now() / 1000) + 180, ...overrides }
}

export async function fixture(scripts = { test: 'node -e "process.exit(0)"' }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mc-polled-test.'))
  const origin = path.join(directory, 'origin'); const checkout = path.join(directory, 'checkout')
  await mkdir(origin); await mkdir(checkout)
  await writeFile(path.join(origin, 'package.json'), JSON.stringify({ name: 'worker-fixture', version: '1.0.0', scripts }))
  const run = createRunner(Date.now() + 30_000, { cwd: origin })
  await run('git', ['init', '--quiet'])
  await run('git', ['add', 'package.json'])
  await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'])
  const sha = await run('git', ['rev-parse', 'HEAD'])
  return { directory, origin, checkout, sha }
}

export function fixtureRunner(source, calls = []) {
  const underlying = createRunner(Date.now() + 30_000)
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, env: options.env, label: options.label })
    if (command === 'git' && args.includes('fetch')) {
      return underlying('git', ['fetch', '--depth', '1', source.origin, source.sha], options)
    }
    return underlying(command, args, options)
  }
  run.stop = underlying.stop
  return run
}


