import { readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createResourceSampler } from './metrics.mjs'

export function createStateWriter(file = '/tmp/mc-worker-state.json') {
  const sample = createResourceSampler(); let sequence = Promise.resolve()
  return function write(state) {
    sequence = sequence.catch(() => {}).then(async () => {
      const payload = { ...state, ...await sample(), updated_at: Math.floor(Date.now() / 1000) }
      const temporary = `${file}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 })
      await rename(temporary, file)
      return payload
    })
    return sequence
  }
}

