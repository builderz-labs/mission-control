import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShufuroMarketingAdapter } from './shufuro-marketing-adapter'
import { acquireShufuroWriteLock } from './shufuro-content-os'
import { contentIntelligenceSchema, distributionVerificationEvidenceSchema } from '@/lib/marketing/content-distribution'
import { externalCapabilityCandidates } from '@/lib/departments/external-capabilities'

const adapter = new ShufuroMarketingAdapter()
let root: string
const queue = () => join(root, '03_PUBLISH_QUEUE.md')
const packet = () => join(root, 'Episodes', 'EP002_fixture.md')
const source = '| 002 | reel | S1 | EP002 | Test | awareness | now | reel | REVIEW |\n'
const initialPacket = '---\nstatus: REVIEW\n---\n# EP002\n'
const renderedQueue = () => source.replace('REVIEW', 'RENDERED')
const renderedPacket = '---\nstatus: RENDERED\n---\n# EP002\n'
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

describe('provider-independent manual distribution', () => {
  beforeEach(() => {
    writeFileSync(queue(), renderedQueue())
    writeFileSync(packet(), renderedPacket)
  })

  const evidence = {
    provider: 'manual', channel: 'instagram', post_id: 'ig-123',
    published_at: '2026-10-05T00:00:00.000Z', verification_state: 'verified', evidence_ref: 'manual:fixture:1',
  }

  it('opens the M10 human publish gate for RENDERED content', async () => {
    const snapshot = await adapter.getSnapshot(instance())
    expect(snapshot.gates).toContainEqual(expect.objectContaining({ id: 'publish:EP002', state: 'open', blocking: true }))
    expect(snapshot.blockers.map((blocker) => blocker.id)).toContain('publish_pending:EP002')
    expect(snapshot.available_commands.find((command) => command.command_id === 'publish-content')?.available).toBe(true)
    expect(adapter.getDefinition().gates.find((gate) => gate.id === 'publish')?.apply_command).toBe('publish-content')
  })

  it('does not progress without approval, current revision, or verified external identity', async () => {
    const before = await adapter.getSnapshot(instance())
    const base = { command_id: 'publish-content', arguments: { gate: 'publish:EP002', publish_evidence: evidence }, expected_revision: before.source.revision, requested_by: 'owner' }
    const unapproved = await adapter.execute(instance(), { ...base, arguments: { ...base.arguments, human_approved: false } })
    const stale = await adapter.execute(instance(), { ...base, arguments: { ...base.arguments, human_approved: true }, expected_revision: 'old' })
    const missing = await adapter.execute(instance(), { ...base, arguments: { ...base.arguments, human_approved: true, publish_evidence: undefined } })
    const unverified = await adapter.execute(instance(), { ...base, arguments: { ...base.arguments, human_approved: true, publish_evidence: { ...evidence, verification_state: 'unverified' } } })
    expect(unapproved.state).toBe('FAILED')
    expect(stale.state).toBe('STALE')
    expect(missing.state).toBe('FAILED')
    expect(unverified.state).toBe('FAILED')
    expect(readFileSync(queue(), 'utf8')).toContain('| RENDERED |')
    expect(readFileSync(packet(), 'utf8')).toContain('status: RENDERED')
    expect((await adapter.getSnapshot(instance())).gates.map((gate) => gate.id)).toContain('publish:EP002')
  })

  it('records verified manual evidence and transitions only to POSTED without network publishing', async () => {
    const before = await adapter.getSnapshot(instance())
    const result = await adapter.execute(instance(), {
      command_id: 'publish-content',
      arguments: { gate: 'publish:EP002', publish_evidence: evidence, human_approved: true },
      expected_revision: before.source.revision,
      requested_by: 'owner',
    })
    expect(result.state).toBe('APPLIED')
    expect(readFileSync(queue(), 'utf8')).toContain('| POSTED |')
    expect(readFileSync(packet(), 'utf8')).toContain('publish_verification: verified')
    const after = await adapter.getSnapshot(instance())
    expect(after.lifecycle.canonical_phase).toBe('operate')
    expect(after.blockers.some((blocker) => blocker.id.startsWith('publish_pending:'))).toBe(false)
    expect(after.artifacts[2]).toEqual(expect.objectContaining({ distribution: expect.objectContaining({ post_id: 'ig-123', verification_state: 'verified' }) }))
    expect(result.stdout_excerpt).toContain('manual evidence')
  })

  it('does not project a bare native POSTED label into operate without publication evidence', async () => {
    writeFileSync(queue(), renderedQueue().replace('RENDERED', 'POSTED'))
    writeFileSync(packet(), '---\nstatus: POSTED\n---\n# EP002\n')
    const snapshot = await adapter.getSnapshot(instance())
    expect(snapshot.lifecycle.canonical_phase).toBe('release')
    expect(snapshot.blockers.map((blocker) => blocker.id)).toContain('publish_unverified:EP002')
  })
})

describe('Shufuro authoritative work context', () => {
  it('keeps EP001 as the native lifecycle artifact and prioritizes EP002 REVIEW work', async () => {
    const queueWithBoth = [
      '| 001 | reel | S1 | EP001 | Older rendered item | awareness | now | reel | RENDERED |',
      '| 002 | reel | S1 | EP002 | New review item | awareness | now | reel | REVIEW |',
      '',
    ].join('\n')
    writeFileSync(queue(), queueWithBoth)
    writeFileSync(join(root, 'Episodes', 'EP001_fixture.md'), '---\nstatus: RENDERED\n---\n# EP001\n')
    writeFileSync(packet(), '---\nstatus: REVIEW\n---\n# EP002\n')

    const snapshot = await adapter.getSnapshot(instance())
    expect(snapshot.lifecycle.native_stage).toBe('EP001:RENDERED')
    expect(snapshot.work_context?.ordered_work_queue).toEqual([
      expect.objectContaining({ action_id: 'review:EP002', target_id: 'EP002', expected_native_state: 'REVIEW' }),
      expect.objectContaining({ action_id: 'publish:EP001', target_id: 'EP001', expected_native_state: 'RENDERED' }),
    ])
    expect(snapshot.work_context?.primary_work_item).toEqual(expect.objectContaining({ target_id: 'EP002' }))
  })
})

describe('reusable content and capability contracts', () => {
  it('normalizes descriptive content fields and rejects invalid values without metrics', () => {
    expect(contentIntelligenceSchema.parse({ topic: '  creator onboarding  ', hook: 'Start here' })).toEqual({ topic: 'creator onboarding', hook: 'Start here' })
    expect(contentIntelligenceSchema.safeParse({ topic: ' ' }).success).toBe(false)
    expect(contentIntelligenceSchema.safeParse({ views: 12 }).success).toBe(false)
  })
  it('validates verified identity and leaves existing capability rows backward compatible', () => {
    expect(distributionVerificationEvidenceSchema.safeParse({ ...{
      provider: 'manual', channel: 'x', post_url: 'https://x.com/user/status/1', published_at: '2026-10-05T00:00:00.000Z', verification_state: 'verified', evidence_ref: 'human:1',
    } }).success).toBe(true)
    expect(externalCapabilityCandidates.every((candidate) => candidate.category && candidate.source && candidate.adoption_state)).toBe(true)
    expect(externalCapabilityCandidates.find((candidate) => candidate.id === 'skillmem')?.permissions).toBeUndefined()
  })
})
