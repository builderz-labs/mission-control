import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanEnvironment, retry } from './process.mjs'

async function exists(file) {
  try { await access(file); return true } catch { return false }
}

export async function packageManager(job, cwd) {
  if (job.setup.startsWith('pnpm-')) return 'pnpm'
  if (job.setup.startsWith('npm-')) return 'npm'
  return await exists(path.join(cwd, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'
}

export async function setupRepository(job, run, cwd) {
  if (job.setup === 'none') return
  if (job.setup.endsWith('-playwright') && process.env.MC_FLY_WORKER_CLASS !== 'browser') throw new Error('Playwright setup requires a browser worker')
  const manager = await packageManager(job, cwd)
  const lock = manager === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json'
  if (!await exists(path.join(cwd, lock))) throw new Error('The selected setup lockfile is missing')
  await retry(run, manager, manager === 'pnpm' ? ['install', '--frozen-lockfile'] : ['ci'], { cwd, label: 'Dependency setup' })
  if (job.setup.endsWith('-playwright')) {
    const args = manager === 'pnpm' ? ['exec', 'playwright', 'install', 'chromium'] : ['exec', '--no', '--', 'playwright', 'install', 'chromium']
    await retry(run, manager, args, { cwd, label: 'Browser setup' })
  }
}

export async function runAgent(job, run, cwd) {
  if (job.runtime === 'command') return
  const prompt = `Work only on the existing isolated branch ${job.branch_name}. Do not push or merge.\n${job.title}\n${job.description}\nRun required checks and report succinctly.`
  const env = cleanEnvironment()
  if (job.runtime === 'claude') {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    const output = await run('claude', ['-p', '--output-format', 'json', '--max-turns', '40', '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash'], {
      cwd, env, input: prompt, label: 'Claude worker',
    })
    let result
    try { result = JSON.parse(output) } catch { throw new Error('Claude returned a malformed result') }
    if (result.type !== 'result' || result.is_error !== false || result.subtype !== 'success') throw new Error('Claude did not report successful completion')
  } else {
    env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
    await run('codex', ['login', '--with-api-key'], { cwd, env, input: env.OPENAI_API_KEY, label: 'Codex API authentication' })
    const output = await run('codex', ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-'], { cwd, env, input: prompt, label: 'Codex worker' })
    let events
    try { events = output.split('\n').filter(Boolean).map(line => JSON.parse(line)) } catch { throw new Error('Codex returned a malformed result') }
    if (!events.some(event => event.type === 'turn.completed') || events.some(event => ['error', 'turn.failed'].includes(event.type))) {
      throw new Error('Codex did not report successful completion')
    }
  }
}

export async function verifyChecks(job, run, cwd) {
  const manager = await packageManager(job, cwd)
  await run('node', ['--version'], { cwd, label: 'Node availability' })
  await run(manager, ['--version'], { cwd, label: 'Package manager availability' })
  for (const check of job.checks) {
    if (check === 'smoke') {
      if (job.setup.endsWith('-playwright')) {
        await run('node', [fileURLToPath(new URL('./browser-smoke.mjs', import.meta.url))], { cwd, label: 'Chromium render smoke' })
      }
      continue
    }
    let manifest
    try { manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) } catch { throw new Error('Package manifest is missing or invalid') }
    if (typeof manifest.scripts?.[check] !== 'string' || !manifest.scripts[check].trim()) throw new Error(`Required package script ${check} is missing`)
    await run(manager, ['run', check], { cwd, label: `Verification ${check}` })
  }
}


