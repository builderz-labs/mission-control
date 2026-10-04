import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShufuroMarketingAdapter } from './shufuro-marketing-adapter'
import { acquireShufuroWriteLock } from './shufuro-content-os'

const adapter = new ShufuroMarketingAdapter()
let root: string
const queue = () => join(root, '03_PUBLISH_QUEUE.md')
const packet = () => join(root, 'Episodes', 'EP002_fixture.md')
const source = '| 002 | reel | S1 | EP002 | Test | awareness | now | reel | REVIEW |\n'
const initialPacket = '---\nstatus: REVIEW\n---\n# EP002\n'
const instance = () => ({
  instance_id: 'marketing:shufuro', module_id: 'marketing-factory',
  adapter_id: adapter.id, native_id: 'shufuro', root_path: root, config: {},
})
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiops-shufuro-fixture-'))
  mkdirSync(join(root, 'Episodes'))
  writeFileSync(join(root, '00_CONTENT_OS_HUB.md'), '---\nversion: 1\n---\n')
  writeFileSync(queue(), source)
  writeFileSync(packet(), initialPacket)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('isolated Shufuro approval', () => {
  it('moves REVIEW to READY only after the local fixture confirms both files', async () => {
    const before = await adapter.getSnapshot(instance())
    expect(before.gates[0]?.id).toBe('content_ready:EP002')
    const result = await adapter.execute(instance(), {
      command_id: 'approve-content', arguments: { gate: 'content_ready:EP002' },
      expected_revision: before.source.revision, requested_by: 'owner',
    })
    expect(result.state).toBe('APPLIED')
    expect(readFileSync(queue(), 'utf8')).toContain('| READY |')
    expect(readFileSync(packet(), 'utf8')).toContain('status: READY')
    expect(result.snapshot?.gates).toHaveLength(0)
  })
  it('blocks a concurrent AI Ops writer without mutating either source file', async () => {
    const before = await adapter.getSnapshot(instance())
    const release = acquireShufuroWriteLock(root, 'test-writer')
    try {
      const result = await adapter.execute(instance(), {
        command_id: 'approve-content',
        arguments: { gate: 'content_ready:EP002' },
        expected_revision: before.source.revision,
        requested_by: 'owner',
      })
      expect(result.state).toBe('FAILED')
      expect(result.error).toContain('locked by another writer')
      expect(readFileSync(queue(), 'utf8')).toBe(source)
      expect(readFileSync(packet(), 'utf8')).toBe(initialPacket)
    } finally {
      release()
    }
  })
  it('does not steal an old lock or release a replacement owner lock', () => {
    const lock = join(root, '.ai-ops-content.lock')
    const release = acquireShufuroWriteLock(root, 'first')
    const old = new Date(Date.now() - 10 * 60 * 1000)
    utimesSync(lock, old, old)
    expect(() => acquireShufuroWriteLock(root, 'second')).toThrow('locked by another writer')
    rmSync(lock)
    writeFileSync(lock, JSON.stringify({ owner: 'replacement', token: 'different' }))
    release()
    expect(existsSync(lock)).toBe(true)
  })
  it('rejects stale and unknown commands without mutating the fixture', async () => {
    const stale = await adapter.execute(instance(), {
      command_id: 'approve-content', arguments: { gate: 'content_ready:EP002' },
      expected_revision: 'old', requested_by: 'owner',
    })
    const unknown = await adapter.execute(instance(), {
      command_id: 'shell', arguments: {}, expected_revision: 'old', requested_by: 'owner',
    })
    expect(stale.state).toBe('STALE')
    expect(unknown.state).toBe('FAILED')
    expect(readFileSync(queue(), 'utf8')).toBe(source)
    expect(readFileSync(packet(), 'utf8')).toBe(initialPacket)
  })
})
