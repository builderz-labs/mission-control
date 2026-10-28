import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../__fixtures__/product-factory-legacy-sonpo-tax-drill.json'

import { ProductFactoryAdapter } from './product-factory-adapter'

let root: string
const slug = 'sonpo-tax-drill'
const readCommand = vi.fn((_root: string, args: string[]) => {
  const output = ({
    status: fixture.status, 'quality-status': fixture.quality,
    'process-audit': fixture.process_audit, 'claude-queue': fixture.claude_queue,
  } as Record<string, unknown>)[args[0]]
  if (!output) throw new Error('Unexpected native read command: ' + args.join(' '))
  return JSON.stringify(output)
})
const adapter = new ProductFactoryAdapter(readCommand)
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiops-product-fixture-'))
  const project = join(root, 'projects', slug)
  mkdirSync(join(project, '.factory'), { recursive: true })
  writeFileSync(join(project, '.factory', 'state.json'), '{}')
  process.env.AI_OPS_PRODUCT_FACTORY_ROOT = root
  readCommand.mockClear()
})
afterEach(() => {
  delete process.env.AI_OPS_PRODUCT_FACTORY_ROOT
  rmSync(root, { recursive: true, force: true })
})
const instance = () => ({
  instance_id: 'product-factory:' + slug, module_id: 'product-factory',
  adapter_id: adapter.id, native_id: slug, root_path: join(root, 'projects', slug), config: {},
})

describe('legacy Product Factory projection and controlled gate', () => {
  it('keeps native stage separate from process readiness and blocks App Review', async () => {
    const snapshot = await adapter.getSnapshot(instance())
    expect(snapshot.lifecycle.native_stage).toBe('TESTFLIGHT_UPLOADED')
    expect(snapshot.lifecycle.process_stage_id).toBeNull()
    expect(snapshot.lifecycle.status).toBe('blocked')
    expect(snapshot.metrics[0]).toMatchObject({ pass_count: 4, total_count: 9 })
    expect(snapshot.review_queues.filter((item) => item.status === 'PENDING')).toHaveLength(3)
    expect(adapter.canExecute(snapshot, {
      command_id: 'approve-gate', arguments: { gate: 'app_review_submit' },
      expected_revision: snapshot.source.revision, requested_by: 'owner',
    }).available).toBe(false)
    const result = await adapter.execute(instance(), {
      command_id: 'approve-gate', arguments: { gate: 'app_review_submit' },
      expected_revision: snapshot.source.revision, requested_by: 'owner',
    })
    expect(result.state).toBe('FAILED')
    expect(readCommand.mock.calls.every(([, args]) => args[0] !== 'approve')).toBe(true)
  })
  it('rejects stale revisions and unsupported symbolic commands without native writes', async () => {
    const stale = await adapter.execute(instance(), {
      command_id: 'approve-gate', arguments: { gate: 'app_review_submit' },
      expected_revision: 'old', requested_by: 'owner',
    })
    expect(stale.state).toBe('STALE')
    const unsupported = await adapter.execute(instance(), {
      command_id: 'shell', arguments: { command: 'anything' },
      expected_revision: 'old', requested_by: 'owner',
    })
    expect(unsupported.state).toBe('FAILED')
    expect(readCommand.mock.calls.every(([, args]) => args[0] !== 'approve')).toBe(true)
  })
})
