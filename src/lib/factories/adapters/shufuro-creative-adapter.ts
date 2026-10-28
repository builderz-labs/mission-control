import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { creativeFactoryDefinition } from '../modules/creative-factory.v1'
import { factorySnapshotSchema } from '../schemas'
import type { FactoryActionAvailability, FactorySnapshot } from '../types'
import type {
  FactoryAdapter,
  FactoryDiscoveredInstance,
  FactoryHealth,
} from './factory-adapter'
import {
  contentRevision,
  frontmatterValue,
  listPostRecords,
  readText,
  shufuroContentRoot,
} from './shufuro-content-os'

const ADAPTER_ID = 'shufuro-creative-assets-v1'
const MODULE_ID = 'creative-factory'

function backtickValues(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\x60([^\x60]+)\x60/g)).map((match) => match[1].trim())
}

function extractAssetPaths(markdown: string): string[] {
  const values = backtickValues(markdown)
  const paths = values.filter((value) => /^[A-Za-z]:\\/.test(value))
  const carouselLine = markdown.split(/\r?\n/).find((line) => line.startsWith('- Carousel:')) || ''
  if (carouselLine.includes('～') && paths.length > 0) {
    const first = paths.find((value) => /\\01\.png$/i.test(value))
    if (first) {
      const dir = dirname(first)
      for (let i = 1; i <= 5; i += 1) {
        const candidate = dir + '\\' + String(i).padStart(2, '0') + '.png'
        if (!paths.includes(candidate)) paths.push(candidate)
      }
    }
  }
  return Array.from(new Set(paths))
}

function qaChecks(markdown: string) {
  const section = markdown.split('# Visual QA')[1]?.split(/^# /m)[0] || ''
  const rows = Array.from(section.matchAll(/^- \[([ xX])\]\s*(.+)$/gm))
  return rows.map((match, index) => ({
    id: 'visual_qa_' + String(index + 1).padStart(2, '0'),
    ok: match[1].toLowerCase() === 'x',
    detail: match[2].trim(),
  }))
}

export class ShufuroCreativeAdapter implements FactoryAdapter {
  readonly id = ADAPTER_ID
  readonly moduleId = MODULE_ID

  getDefinition() {
    return creativeFactoryDefinition
  }

  async discoverInstances(): Promise<FactoryDiscoveredInstance[]> {
    const root = shufuroContentRoot()
    return listPostRecords(root).map((record) => {
      const markdown = readFileSync(record, 'utf8')
      const postId = frontmatterValue(markdown, 'post_id') || record.split(/[\\/]/).at(-1)?.replace(/\.md$/i, '') || 'unknown'
      return {
        instance_id: 'creative:shufuro:' + postId.toLowerCase(),
        module_id: MODULE_ID,
        adapter_id: ADAPTER_ID,
        native_id: postId,
        root_path: record,
        config: { project: 'shufuro', content_root: root },
      }
    })
  }

  async healthCheck(instance: FactoryDiscoveredInstance): Promise<FactoryHealth> {
    const ok = existsSync(instance.root_path)
    return {
      ok,
      detail: ok ? 'Creative post record is readable.' : 'Creative post record is missing.',
      checked_at: new Date().toISOString(),
    }
  }

  getAvailableCommands(_snapshot: FactorySnapshot): FactoryActionAvailability[] {
    return [{ command_id: 'refresh', available: true, risk: 'low' }]
  }

  async getSnapshot(instance: FactoryDiscoveredInstance): Promise<FactorySnapshot> {
    const markdown = readText(instance.root_path)
    const now = new Date().toISOString()
    const status = (frontmatterValue(markdown, 'status') || 'UNKNOWN').toUpperCase()
    const sourceEpisode = frontmatterValue(markdown, 'source_episode')
    const format = frontmatterValue(markdown, 'format')
    const assetPaths = extractAssetPaths(markdown)
    const assetChecks = assetPaths.map((path, index) => ({
      id: 'asset_' + String(index + 1).padStart(2, '0'),
      ok: existsSync(path),
      detail: path,
    }))
    const visualChecks = qaChecks(markdown)
    const checks = [...assetChecks, ...visualChecks]
    const failed = checks.filter((check) => !check.ok)
    const revision = contentRevision([markdown, ...assetPaths.map((path) => existsSync(path) ? path : 'missing:' + path)])

    const processStage = status === 'RENDERED' ? 'C14'
      : status === 'READY' ? 'C08'
        : status === 'POSTED' || status === 'MEASURED' ? 'C14'
          : null

    const snapshot: FactorySnapshot = {
      snapshot_version: '1.0',
      instance_id: instance.instance_id,
      module_id: MODULE_ID,
      observed_at: now,
      source: {
        authority: instance.root_path,
        native_id: instance.native_id,
        revision,
        adapter_version: '1',
      },
      freshness: { state: 'fresh', last_success_at: now, last_error: null },
      lifecycle: {
        process_stage_id: processStage,
        native_stage: status,
        canonical_phase: 'design',
        status: failed.length > 0 ? 'blocked' : status === 'RENDERED' || status === 'POSTED' || status === 'MEASURED' ? 'completed' : 'running',
      },
      compatibility: {
        native_version: 'post-record-v0.1',
        contract_coverage: 'partial',
        warnings: ['Creative projection reads existing Shufuro render/post records; production commands remain outside the common Factory adapter for now.'],
      },
      gates: [],
      checks,
      artifacts: assetPaths.map((path) => ({ path, exists: existsSync(path), source_episode: sourceEpisode, format })),
      review_queues: [],
      next_actions: failed.map((check) => ({
        id: 'fix:' + check.id,
        label: 'Fix creative check: ' + check.detail,
        kind: 'deterministic_fix',
        blocking: true,
      })),
      blockers: failed.map((check) => ({
        id: 'check:' + check.id,
        label: 'Creative asset/QA check failed',
        detail: check.detail,
        source: 'post-record',
      })),
      risks: [],
      metrics: [],
      available_commands: [],
      raw_summary: {
        source_episode: sourceEpisode,
        format,
        asset_count: assetPaths.length,
        qa_count: visualChecks.length,
      },
    }
    snapshot.available_commands = this.getAvailableCommands(snapshot)
    return factorySnapshotSchema.parse(snapshot) as FactorySnapshot
  }
}

export const shufuroCreativeAdapter = new ShufuroCreativeAdapter()
