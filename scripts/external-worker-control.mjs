#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'

process.env.TS_NODE_TRANSPILE_ONLY = '1'
const root = path.resolve(process.cwd())
const mod = await import(path.join(root, 'src/lib/external-workers.ts'))

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return process.argv[i + 1] ?? fallback
}

async function main() {
  const cmd = process.argv[2]
  if (!cmd) throw new Error('usage: external-worker-control.mjs <spawn|babysit|steer|retry-packet|list> ...')

  if (cmd === 'list') {
    console.log(JSON.stringify(mod.listExternalWorkers(), null, 2))
    return
  }

  if (cmd === 'babysit') {
    console.log(JSON.stringify(await mod.babysitExternalWorkers(), null, 2))
    return
  }

  if (cmd === 'steer') {
    const workerId = Number(arg('worker-id'))
    const note = arg('note', '')
    console.log(JSON.stringify(await mod.steerExternalWorker(workerId, note), null, 2))
    return
  }

  if (cmd === 'retry-packet') {
    const workerId = Number(arg('worker-id'))
    const diagnosis = arg('diagnosis', 'Diagnosis pending')
    const correctedContext = arg('corrected-context', '')
    const narrowedScope = arg('narrowed-scope', '')
    const doNotRepeat = (arg('do-not-repeat', '') || '').split('||').filter(Boolean)
    console.log(JSON.stringify(mod.buildRetryPacket(workerId, diagnosis, correctedContext, narrowedScope, doNotRepeat), null, 2))
    return
  }

  if (cmd === 'spawn') {
    const prompt = arg('prompt')
    if (!prompt) throw new Error('--prompt is required')
    const result = await mod.spawnExternalWorker({
      taskId: arg('task-id') ? Number(arg('task-id')) : undefined,
      roleOwner: arg('role-owner', 'jim'),
      tool: arg('tool', 'codex'),
      model: arg('model'),
      branch: arg('branch', ''),
      taskTitle: arg('task-title', 'ad hoc external worker task'),
      prompt,
      repoPath: arg('repo-path'),
      baseRef: arg('base-ref'),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  throw new Error(`unknown command: ${cmd}`)
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exit(1)
})
