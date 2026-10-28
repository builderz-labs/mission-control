import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { marketingFactoryDefinition } from '../modules/marketing-factory.v1'
import { factorySnapshotSchema } from '../schemas'
import { distributionVerificationEvidenceSchema } from '@/lib/marketing/content-distribution'
import type { DistributionVerificationEvidence } from '@/lib/marketing/content-distribution'
import type { FactoryActionAvailability, FactorySnapshot } from '../types'
import type {
  FactoryAdapter,
  FactoryCommandRequest,
  FactoryCommandResult,
  FactoryDiscoveredInstance,
  FactoryHealth,
} from './factory-adapter'
import {
  acquireShufuroWriteLock,
  contentRevision,
  findEpisodePacket,
  frontmatterValue,
  parseQueue,
  readText,
  shufuroContentRoot,
} from './shufuro-content-os'

const ADAPTER_ID = 'shufuro-marketing-content-os-v1'
const MODULE_ID = 'marketing-factory'

function stageForStatus(status: string, verifiedPosted = true): string {
  if (status === 'REVIEW') return 'M08'
  if (status === 'READY') return 'M08'
  if (status === 'RENDERED') return 'M10'
  if (status === 'POSTED') return verifiedPosted ? 'M11' : 'M10'
  if (status === 'MEASURED') return 'M12'
  return 'M05'
}

function canonicalForStatus(status: string, verifiedPosted = true) {
  if (status === 'POSTED') return verifiedPosted ? 'operate' as const : 'release' as const
  if (status === 'MEASURED') return 'operate' as const
  if (status === 'RENDERED') return 'release' as const
  if (status === 'READY' || status === 'REVIEW') return 'design' as const
  return 'research' as const
}

function updateQueueStatus(markdown: string, episode: string, expected: string, next: string): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  let changed = false
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('| ' + episode + ' |')) continue
    const cells = lines[i].split('|')
    if (cells.length < 10) continue
    const statusIndex = cells.length - 2
    const current = cells[statusIndex].trim().toUpperCase()
    if (current !== expected) throw new Error(`Content OS ${episode} is ${current}; expected ${expected}.`)
    cells[statusIndex] = ' ' + next + ' '
    lines[i] = cells.join('|')
    changed = true
    break
  }
  if (!changed) throw new Error(`Content OS queue row not found for ${episode}.`)
  return lines.join(eol)
}

function updatePacketStatus(markdown: string, expected: string, next: string): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') throw new Error('Episode packet has no frontmatter.')
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') break
    if (!/^status:\s*/i.test(lines[i])) continue
    const current = lines[i].split(':').slice(1).join(':').trim().toUpperCase()
    if (current !== expected) throw new Error(`Episode packet is ${current}; expected ${expected}.`)
    lines[i] = 'status: ' + next
    return lines.join(eol)
  }
  throw new Error('Episode packet status field not found.')
}

function updatePacketPublishEvidence(markdown: string, evidence: DistributionVerificationEvidence): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') throw new Error('Episode packet has no frontmatter.')
  const fields: Record<string, string> = {
    publish_provider: evidence.provider,
    publish_channel: evidence.channel,
    publish_verification: evidence.verification_state,
    published_at: evidence.published_at,
    publish_evidence_ref: evidence.evidence_ref,
  }
  if (evidence.post_id) fields.publish_post_id = evidence.post_id
  if (evidence.post_url) fields.publish_post_url = evidence.post_url
  let end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) throw new Error('Episode packet frontmatter is not closed.')
  for (const [key, value] of Object.entries(fields)) {
    const index = lines.findIndex((line, lineIndex) => lineIndex > 0 && lineIndex < end && line.startsWith(key + ':'))
    const serialized = `${key}: ${value.replace(/[\r\n]/g, '')}`
    if (index >= 0) lines[index] = serialized
    else { lines.splice(end, 0, serialized); end += 1 }
  }
  return lines.join(eol)
}

export class ShufuroMarketingAdapter implements FactoryAdapter {
  readonly id = ADAPTER_ID
  readonly moduleId = MODULE_ID

  getDefinition() {
    return marketingFactoryDefinition
  }

  async discoverInstances(): Promise<FactoryDiscoveredInstance[]> {
    const root = shufuroContentRoot()
    const queue = join(root, '03_PUBLISH_QUEUE.md')
    try {
      readFileSync(queue, 'utf8')
    } catch {
      return []
    }
    return [{
      instance_id: 'marketing:shufuro',
      module_id: MODULE_ID,
      adapter_id: ADAPTER_ID,
      native_id: 'shufuro',
      root_path: root,
      config: { queue_path: queue },
    }]
  }

  async healthCheck(instance: FactoryDiscoveredInstance): Promise<FactoryHealth> {
    try {
      const queue = readText(join(instance.root_path, '03_PUBLISH_QUEUE.md'))
      const rows = parseQueue(queue)
      return {
        ok: rows.length > 0,
        detail: rows.length > 0 ? `Content OS queue readable: ${rows.length} rows.` : 'Content OS queue has no rows.',
        checked_at: new Date().toISOString(),
      }
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'Shufuro Marketing Content OS unavailable.',
        checked_at: new Date().toISOString(),
      }
    }
  }

  getAvailableCommands(snapshot: FactorySnapshot): FactoryActionAvailability[] {
    const readyGate = snapshot.gates.find((gate) => gate.id.startsWith('content_ready:') && gate.state === 'open')
    return [
      { command_id: 'refresh', available: true, risk: 'low' },
      {
        command_id: 'approve-content',
        available: Boolean(readyGate),
        risk: 'medium',
        reason: readyGate ? null : 'No REVIEW episode is waiting for Founder approval.',
      },
      {
        command_id: 'publish-content',
        available: snapshot.gates.some((gate) => gate.id.startsWith('publish:') && gate.state === 'open'),
        risk: 'high',
        reason: snapshot.gates.some((gate) => gate.id.startsWith('publish:') && gate.state === 'open') ? null : 'No RENDERED episode is waiting for verified manual publication evidence.',
      },
    ]
  }

  canExecute(snapshot: FactorySnapshot, request: FactoryCommandRequest): FactoryActionAvailability {
    if (request.command_id !== 'approve-content' && request.command_id !== 'publish-content') {
      const known = this.getAvailableCommands(snapshot).find((item) => item.command_id === request.command_id)
      return known || { command_id: request.command_id, available: false, risk: 'critical', reason: 'Unknown symbolic command.' }
    }
    const gate = String(request.arguments.gate || '')
    const nativeGate = snapshot.gates.find((item) => item.id === gate)
    if (request.command_id === 'publish-content') {
      return nativeGate?.state === 'open' && gate.startsWith('publish:')
        ? { command_id: 'publish-content', available: true, risk: 'high' }
        : { command_id: 'publish-content', available: false, risk: 'high', reason: 'Requested publish gate is not open.' }
    }
    return nativeGate?.state === 'open'
      ? { command_id: 'approve-content', available: true, risk: 'medium' }
      : { command_id: 'approve-content', available: false, risk: 'medium', reason: 'Requested content gate is not open.' }
  }

  async execute(instance: FactoryDiscoveredInstance, request: FactoryCommandRequest): Promise<FactoryCommandResult> {
    if (request.command_id === 'publish-content') return this.executePublish(instance, request)
    if (request.command_id !== 'approve-content') {
      return {
        state: 'FAILED',
        before_revision: null,
        after_revision: null,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Only approve-content is enabled for Shufuro Marketing.',
        snapshot: null,
      }
    }

    const gate = String(request.arguments.gate || '')
    const episode = gate.startsWith('content_ready:') ? gate.slice('content_ready:'.length) : String(request.arguments.episode || '')
    if (!/^(EP|TIP)\d{3}$/i.test(episode)) {
      return {
        state: 'FAILED',
        before_revision: null,
        after_revision: null,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Invalid episode approval reference.',
        snapshot: null,
      }
    }

    const before = await this.getSnapshot(instance)
    if (!request.expected_revision || before.source.revision !== request.expected_revision) {
      return {
        state: 'STALE',
        before_revision: before.source.revision,
        after_revision: null,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Marketing Content OS changed after the approval request was opened.',
        snapshot: before,
      }
    }

    const nativeGate = before.gates.find((item) => item.id === 'content_ready:' + episode)
    if (!nativeGate || nativeGate.state !== 'open') {
      return {
        state: 'STALE',
        before_revision: before.source.revision,
        after_revision: before.source.revision,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Episode is no longer waiting in REVIEW.',
        snapshot: before,
      }
    }

    const root = instance.root_path
    const queuePath = join(root, '03_PUBLISH_QUEUE.md')
    const packetPath = findEpisodePacket(root, episode)
    if (!packetPath) {
      return {
        state: 'FAILED',
        before_revision: before.source.revision,
        after_revision: before.source.revision,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Episode packet was not found.',
        snapshot: before,
      }
    }

    let releaseLock: (() => void) | null = null
    try {
      releaseLock = acquireShufuroWriteLock(root, `approve-content:${episode}`)
    } catch (error) {
      return {
        state: 'FAILED',
        before_revision: before.source.revision,
        after_revision: before.source.revision,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: error instanceof Error ? error.message : 'Shufuro Content OS write lock unavailable.',
        snapshot: before,
      }
    }

    try {
      // Re-read after the lock is acquired so another AI Ops writer cannot slip
      // a mutation between the approval revision check and the two-file commit.
      const lockedBefore = await this.getSnapshot(instance)
      if (!request.expected_revision || lockedBefore.source.revision !== request.expected_revision) {
        return {
          state: 'STALE',
          before_revision: lockedBefore.source.revision,
          after_revision: null,
          stdout_excerpt: '',
          stderr_excerpt: '',
          error: 'Marketing Content OS changed before the write lock was acquired.',
          snapshot: lockedBefore,
        }
      }

      const queueBefore = readText(queuePath)
      const packetBefore = readText(packetPath)
      let queueAfter: string
      let packetAfter: string
      try {
        queueAfter = updateQueueStatus(queueBefore, episode, 'REVIEW', 'READY')
        packetAfter = updatePacketStatus(packetBefore, 'REVIEW', 'READY')
        writeFileSync(packetPath, packetAfter, 'utf8')
        writeFileSync(queuePath, queueAfter, 'utf8')
      } catch (error) {
        try { writeFileSync(packetPath, packetBefore, 'utf8') } catch {}
        try { writeFileSync(queuePath, queueBefore, 'utf8') } catch {}
        return {
          state: 'FAILED',
          before_revision: lockedBefore.source.revision,
          after_revision: lockedBefore.source.revision,
          stdout_excerpt: '',
          stderr_excerpt: '',
          error: error instanceof Error ? error.message : 'Failed to promote Content OS episode.',
          snapshot: lockedBefore,
        }
      }

      const after = await this.getSnapshot(instance)
      const rowReady = parseQueue(readText(queuePath)).some((row) => row.episode === episode && row.status === 'READY')
      const packetReady = frontmatterValue(readText(packetPath), 'status')?.toUpperCase() === 'READY'
      return {
        state: rowReady && packetReady ? 'APPLIED' : 'UNKNOWN',
        before_revision: lockedBefore.source.revision,
        after_revision: after.source.revision,
        stdout_excerpt: rowReady && packetReady ? `${episode} promoted REVIEW → READY.` : '',
        stderr_excerpt: '',
        error: rowReady && packetReady ? null : 'Source files were written but READY confirmation was incomplete.',
        snapshot: after,
      }
    } finally {
      releaseLock?.()
    }
  }

  private async executePublish(instance: FactoryDiscoveredInstance, request: FactoryCommandRequest): Promise<FactoryCommandResult> {
    const gate = String(request.arguments.gate || '')
    const episode = gate.startsWith('publish:') ? gate.slice('publish:'.length) : ''
    const evidenceResult = distributionVerificationEvidenceSchema.safeParse(request.arguments.publish_evidence)
    const before = await this.getSnapshot(instance)
    if (request.arguments.human_approved !== true) return {
      state: 'FAILED', before_revision: before.source.revision, after_revision: before.source.revision,
      stdout_excerpt: '', stderr_excerpt: '', error: 'Human approval is required before recording publication evidence.', snapshot: before,
    }
    if (!/^(EP|TIP)\d{3}$/i.test(episode) || !evidenceResult.success
      || (evidenceResult.success && evidenceResult.data.provider === 'mock' && process.env.NODE_ENV !== 'test')) return {
      state: 'FAILED', before_revision: before.source.revision, after_revision: before.source.revision,
      stdout_excerpt: '', stderr_excerpt: '', error: 'Missing or invalid verified manual publication evidence.', snapshot: before,
    }
    const evidence = evidenceResult.data
    if (!request.expected_revision || before.source.revision !== request.expected_revision) return {
      state: 'STALE', before_revision: before.source.revision, after_revision: null,
      stdout_excerpt: '', stderr_excerpt: '', error: 'Marketing Content OS changed after the publish approval request was opened.', snapshot: before,
    }
    if (!before.gates.some((item) => item.id === gate && item.state === 'open')) return {
      state: 'STALE', before_revision: before.source.revision, after_revision: before.source.revision,
      stdout_excerpt: '', stderr_excerpt: '', error: 'Episode is no longer waiting for publication evidence.', snapshot: before,
    }

    let releaseLock: (() => void) | null = null
    try { releaseLock = acquireShufuroWriteLock(instance.root_path, `publish-content:${episode}`) }
    catch (error) { return {
      state: 'FAILED', before_revision: before.source.revision, after_revision: before.source.revision,
      stdout_excerpt: '', stderr_excerpt: '', error: error instanceof Error ? error.message : 'Shufuro Content OS write lock unavailable.', snapshot: before,
    } }
    let rollbackQueue: { path: string; contents: string } | null = null
    let rollbackPacket: { path: string; contents: string } | null = null
    try {
      const lockedBefore = await this.getSnapshot(instance)
      if (lockedBefore.source.revision !== request.expected_revision) return {
        state: 'STALE', before_revision: lockedBefore.source.revision, after_revision: null,
        stdout_excerpt: '', stderr_excerpt: '', error: 'Marketing Content OS changed before the publish write lock was acquired.', snapshot: lockedBefore,
      }
      const queuePath = join(instance.root_path, '03_PUBLISH_QUEUE.md')
      const packetPath = findEpisodePacket(instance.root_path, episode)
      if (!packetPath) throw new Error('Episode packet was not found.')
      const queueBefore = readText(queuePath)
      const packetBefore = readText(packetPath)
      rollbackQueue = { path: queuePath, contents: queueBefore }
      rollbackPacket = { path: packetPath, contents: packetBefore }
      try {
        const queueAfter = updateQueueStatus(queueBefore, episode, 'RENDERED', 'POSTED')
        const packetAfter = updatePacketPublishEvidence(updatePacketStatus(packetBefore, 'RENDERED', 'POSTED'), evidence)
        writeFileSync(packetPath, packetAfter, 'utf8')
        writeFileSync(queuePath, queueAfter, 'utf8')
      } catch (error) {
        try { writeFileSync(packetPath, packetBefore, 'utf8') } catch {}
        try { writeFileSync(queuePath, queueBefore, 'utf8') } catch {}
        throw error
      }
      const after = await this.getSnapshot(instance)
      const verified = parseQueue(readText(queuePath)).some((row) => row.episode === episode && row.status === 'POSTED')
        && frontmatterValue(readText(packetPath), 'publish_verification') === 'verified'
        && (frontmatterValue(readText(packetPath), 'publish_post_id') || frontmatterValue(readText(packetPath), 'publish_post_url'))
      return {
        state: verified ? 'APPLIED' : 'UNKNOWN', before_revision: lockedBefore.source.revision, after_revision: after.source.revision,
        stdout_excerpt: verified ? `${episode} recorded as POSTED with verified ${evidence.provider} evidence.` : '',
        stderr_excerpt: '', error: verified ? null : 'Publication evidence confirmation was incomplete.', snapshot: after,
      }
    } catch (error) {
      if (rollbackPacket) { try { writeFileSync(rollbackPacket.path, rollbackPacket.contents, 'utf8') } catch {} }
      if (rollbackQueue) { try { writeFileSync(rollbackQueue.path, rollbackQueue.contents, 'utf8') } catch {} }
      return { state: 'FAILED', before_revision: before.source.revision, after_revision: before.source.revision,
        stdout_excerpt: '', stderr_excerpt: '', error: error instanceof Error ? error.message : 'Failed to record publication evidence.', snapshot: before }
    } finally { releaseLock?.() }
  }

  async getSnapshot(instance: FactoryDiscoveredInstance): Promise<FactorySnapshot> {
    const root = instance.root_path
    const queuePath = join(root, '03_PUBLISH_QUEUE.md')
    const hubPath = join(root, '00_CONTENT_OS_HUB.md')
    const queueText = readText(queuePath)
    const hubText = readText(hubPath)
    const rows = parseQueue(queueText)

    const current = rows.find((row) => ['READY', 'RENDERED', 'POSTED'].includes(row.status))
      || rows.find((row) => row.status === 'MEASURED')
      || rows.find((row) => row.status === 'REVIEW')
      || null
    const review = rows.find((row) => row.status === 'REVIEW') || null

    const currentPacketPath = current ? findEpisodePacket(root, current.episode) : null
    const currentPacketText = currentPacketPath ? readText(currentPacketPath) : null
    const storedDistributionEvidence = current?.status === 'POSTED' && currentPacketText
      ? distributionVerificationEvidenceSchema.safeParse({
          provider: frontmatterValue(currentPacketText, 'publish_provider'),
          channel: frontmatterValue(currentPacketText, 'publish_channel'),
          post_id: frontmatterValue(currentPacketText, 'publish_post_id') || undefined,
          post_url: frontmatterValue(currentPacketText, 'publish_post_url') || undefined,
          published_at: frontmatterValue(currentPacketText, 'published_at'),
          verification_state: frontmatterValue(currentPacketText, 'publish_verification'),
          evidence_ref: frontmatterValue(currentPacketText, 'publish_evidence_ref'),
        })
      : null
    const verifiedPosted = storedDistributionEvidence?.success === true
    const packetParts: string[] = []
    if (currentPacketText) packetParts.push(currentPacketText)
    if (review && review.episode !== current?.episode) {
      const packet = findEpisodePacket(root, review.episode)
      if (packet) packetParts.push(readText(packet))
    }

    const revision = contentRevision([queueText, hubText, ...packetParts])
    const now = new Date().toISOString()
    const gates = review ? [{
      id: 'content_ready:' + review.episode,
      state: 'open' as const,
      blocking: true,
      note: `${review.episode} Founder content review required.`,
      evidence_refs: [`episode:${review.episode}`, `queue:${review.order}`],
    }] : []
    if (current?.status === 'RENDERED') gates.push({
      id: 'publish:' + current.episode,
      state: 'open' as const,
      blocking: true,
      note: `${current.episode} requires human approval and verified manual publication evidence.`,
      evidence_refs: [`episode:${current.episode}`, `queue:${current.order}`],
    })

    const checks = [
      { id: 'content_os_queue', ok: rows.length > 0, detail: `${rows.length} queue rows parsed` },
      { id: 'single_format_from_ep002', ok: true, detail: 'Policy lives in Content OS; selected format is projected per row.' },
    ]

    const blockers = []
    if (current?.status === 'RENDERED') {
      blockers.push({
        id: 'publish_pending:' + current.episode,
        label: `${current.episode} rendered but not verified POSTED`,
        detail: 'Publishing remains an external side effect and requires verified platform URL.',
        source: 'content-os',
      })
    }
    if (current?.status === 'POSTED' && !verifiedPosted) blockers.push({
      id: 'publish_unverified:' + current.episode,
      label: `${current.episode} is marked POSTED without verifiable publication identity`,
      detail: 'A verified provider/channel and external post ID or canonical URL are required for operate state.',
      source: 'content-os',
    })

    const nextActions = [
      ...(review ? [{ id: 'review:' + review.episode, label: `Review ${review.episode}: ${review.title}`, kind: 'human_gate', blocking: true }] : []),
      ...(current?.status === 'RENDERED' ? [{ id: 'publish:' + current.episode, label: `Publish and verify ${current.episode}`, kind: 'external_side_effect', blocking: true }] : []),
    ]
    const orderedWorkQueue = nextActions.map((action) => {
      const targetId = action.id.slice(action.id.indexOf(':') + 1)
      const row = rows.find((item) => item.episode === targetId)
      return {
        action_id: action.id,
        target_id: targetId,
        expected_native_state: row?.status || null,
        action_kind: action.kind,
        blocking: action.blocking,
        label: action.label,
      }
    })

    const snapshot: FactorySnapshot = {
      snapshot_version: '1.0',
      instance_id: instance.instance_id,
      module_id: MODULE_ID,
      observed_at: now,
      source: {
        authority: root,
        native_id: 'shufuro',
        revision,
        adapter_version: '1',
      },
      freshness: { state: 'fresh', last_success_at: now, last_error: null },
      lifecycle: {
        process_stage_id: current ? stageForStatus(current.status, verifiedPosted) : null,
        native_stage: current ? `${current.episode}:${current.status}` : null,
        canonical_phase: current ? canonicalForStatus(current.status, verifiedPosted) : 'unknown',
        status: blockers.length > 0 ? 'blocked' : review ? 'blocked' : 'ready',
      },
      compatibility: {
        native_version: frontmatterValue(hubText, 'version') || '0.1',
        contract_coverage: 'partial',
        warnings: ['Shufuro Content OS is being migrated into the common Factory contract without changing its native files.'],
      },
      gates,
      checks,
      artifacts: [
        { id: 'content_os_hub', path: hubPath },
        { id: 'publish_queue', path: queuePath },
        ...(current ? [{
          id: 'current_episode', episode: current.episode, status: current.status, format: current.format,
          ...(current.status === 'POSTED' && storedDistributionEvidence?.success ? {
            distribution: {
              ...storedDistributionEvidence.data,
            },
          } : {}),
        }] : []),
        ...(review ? [{ id: 'next_review', episode: review.episode, status: review.status, format: review.format }] : []),
      ],
      review_queues: [],
      next_actions: nextActions,
      work_context: {
        source_revision: revision,
        ordered_work_queue: orderedWorkQueue,
        primary_work_item: orderedWorkQueue[0] || null,
      },
      blockers,
      risks: [],
      metrics: [],
      available_commands: [],
      raw_summary: {
        queue_rows: rows.length,
        current_episode: current?.episode || null,
        current_status: current?.status || null,
        next_review: review?.episode || null,
      },
    }
    snapshot.available_commands = this.getAvailableCommands(snapshot)
    return factorySnapshotSchema.parse(snapshot) as FactorySnapshot
  }
}

export const shufuroMarketingAdapter = new ShufuroMarketingAdapter()
