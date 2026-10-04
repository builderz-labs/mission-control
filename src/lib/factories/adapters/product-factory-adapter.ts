import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { productFactoryDefinition } from '../modules/product-factory.v1'
import { factorySnapshotSchema } from '../schemas'
import type {
  FactoryActionAvailability,
  FactoryCanonicalPhase,
  FactoryCheckSnapshot,
  FactoryGateSnapshot,
  FactoryReviewQueueItem,
  FactorySnapshot,
} from '../types'
import type {
  FactoryAdapter,
  FactoryCommandRequest,
  FactoryCommandResult,
  FactoryDiscoveredInstance,
  FactoryHealth,
} from './factory-adapter'

const ADAPTER_ID = 'product-factory-local-v1'
const MODULE_ID = 'product-factory'
const DEFAULT_ROOT = 'C:\\Dev\\product-factory'
const READ_TIMEOUT_MS = 30_000
const OUTPUT_LIMIT = 1_000_000
const GATES = productFactoryDefinition.gates.map((gate) => gate.id)

interface NativeStatus {
  path?: string
  state?: Record<string, unknown>
  gates?: Record<string, unknown>
}

interface NativeQuality {
  slug?: string
  stage?: string
  testflight_upload_status?: string
  checks?: Array<{ label?: string; ok?: boolean; detail?: string }>
  pass_count?: number
  total_count?: number
  all_quality_checks_pass?: boolean
}

interface NativeAudit {
  slug?: string
  version?: string
  current_stage?: string
  checks?: unknown[]
}

interface NativeQueue {
  version?: number
  items?: Array<Record<string, unknown>>
}

function rootPath(): string {
  return resolve(process.env.AI_OPS_PRODUCT_FACTORY_ROOT || DEFAULT_ROOT)
}

function ensureContained(root: string, candidate: string): string {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  const rel = relative(normalizedRoot, normalizedCandidate)
  if (rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !rel.startsWith('..'))) return normalizedCandidate
  throw new Error('Product Factory path escaped configured root')
}

function assertSlug(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new Error('Invalid Product Factory slug')
  return slug
}

function run(root: string, args: string[]): string {
  const python = process.env.AI_OPS_PYTHON || 'python'
  const result = spawnSync(python, ['factory.py', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: READ_TIMEOUT_MS,
    maxBuffer: OUTPUT_LIMIT,
    windowsHide: true,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Product Factory command failed: ${args[0]}`).trim())
  }
  return String(result.stdout || '').trim()
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1)) as T
      } catch {
        // fall through
      }
    }
    throw new Error(`${label} did not return valid JSON`)
  }
}

function gitRevision(projectPath: string): string | null {
  const result = spawnSync('git', ['-C', projectPath, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
    shell: false,
  })
  if (result.status !== 0) return null
  const value = String(result.stdout || '').trim()
  return /^[0-9a-f]{7,64}$/i.test(value) ? value : null
}

function canonicalPhase(nativeStage: string | null): FactoryCanonicalPhase {
  if (!nativeStage) return 'unknown'
  const stage = nativeStage.toUpperCase()
  if (stage.includes('KILL') || stage.includes('ARCHIV')) return 'closed'
  if (stage.includes('MEASURE') || stage.includes('METRIC') || stage.includes('SCALE')) return 'learn'
  if (stage.includes('REVIEW') || stage.includes('TESTFLIGHT') || stage.includes('RELEASE') || stage.includes('SUBMIT')) return 'release'
  if (stage.includes('QA') || stage.includes('TEST')) return 'qa'
  if (stage.includes('IMPLEMENT') || stage.includes('BUILD')) return 'build'
  if (stage.includes('DESIGN') || stage.includes('PROTOTYPE') || stage.includes('CREATIVE')) return 'design'
  if (stage.includes('VALID') || stage.includes('BUSINESS') || stage.includes('DEMAND')) return 'validate'
  if (stage.includes('RESEARCH') || stage.includes('EVIDENCE')) return 'research'
  if (stage.includes('INTAKE') || stage.includes('NEW')) return 'intake'
  return 'unknown'
}

function buildGates(status: NativeStatus): FactoryGateSnapshot[] {
  const native = status.gates || {}
  return GATES.map((id) => {
    if (!(id in native)) {
      return { id, state: 'unavailable', blocking: true, evidence_refs: [] }
    }
    const approved = native[id] === true
    const decidedAt = typeof native[`${id}_approved_at`] === 'string' ? String(native[`${id}_approved_at`]) : null
    const note = typeof native[`${id}_note`] === 'string' ? String(native[`${id}_note`]) : null
    return {
      id,
      state: approved ? 'approved' : 'open',
      blocking: true,
      decided_at: decidedAt,
      note,
      evidence_refs: [],
    }
  })
}

function buildChecks(quality: NativeQuality): FactoryCheckSnapshot[] {
  return (quality.checks || []).map((check) => ({
    id: String(check.label || 'unknown'),
    ok: check.ok === true,
    detail: String(check.detail || ''),
  }))
}

function reviewSymbol(kind: string): string | null {
  const map: Record<string, string> = {
    product_redteam: 'rerun-product-redteam',
    design_director: 'rerun-design-director',
    release_redteam: 'rerun-release-redteam',
  }
  return map[kind] || null
}

function buildReviewQueue(queue: NativeQueue): FactoryReviewQueueItem[] {
  return (queue.items || []).map((item) => {
    const kind = String(item.kind || 'unknown')
    return {
      kind,
      status: String(item.status || 'UNKNOWN'),
      queued_at: typeof item.queued_at === 'string' ? item.queued_at : null,
      last_error: typeof item.last_error === 'string' ? item.last_error : null,
      symbolic_action: reviewSymbol(kind),
    }
  })
}

function sourceHash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export class ProductFactoryAdapter implements FactoryAdapter {
  readonly id = ADAPTER_ID
  readonly moduleId = MODULE_ID

  constructor(private readonly readCommand: (root: string, args: string[]) => string = run) {}

  getDefinition() {
    return productFactoryDefinition
  }

  async discoverInstances(): Promise<FactoryDiscoveredInstance[]> {
    const root = rootPath()
    const projects = ensureContained(root, resolve(root, 'projects'))
    if (!existsSync(projects)) return []

    const instances: FactoryDiscoveredInstance[] = []
    for (const entry of readdirSync(projects, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name)) continue
      const projectPath = ensureContained(root, resolve(projects, entry.name))
      const statePath = resolve(projectPath, '.factory', 'state.json')
      if (!existsSync(statePath)) continue
      instances.push({
        instance_id: `product-factory:${entry.name}`,
        module_id: MODULE_ID,
        adapter_id: ADAPTER_ID,
        native_id: entry.name,
        root_path: projectPath,
        config: { factory_root: root },
      })
    }
    return instances
  }

  async healthCheck(instance: FactoryDiscoveredInstance): Promise<FactoryHealth> {
    try {
      const slug = assertSlug(instance.native_id)
      const root = rootPath()
      ensureContained(root, instance.root_path)
      this.readCommand(root, ['status', '--slug', slug])
      return { ok: true, detail: 'Product Factory status command succeeded.', checked_at: new Date().toISOString() }
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'Product Factory health check failed.',
        checked_at: new Date().toISOString(),
      }
    }
  }

  getAvailableCommands(snapshot: FactorySnapshot): FactoryActionAvailability[] {
    const open = snapshot.gates.filter((gate) => gate.state === 'open')
    const releasableOpen = open.filter((gate) => gate.id !== 'app_review_submit')
    const appReviewOpen = open.some((gate) => gate.id === 'app_review_submit')
    const appReviewSafe = appReviewOpen && snapshot.blockers.length === 0
    const approveAvailable = releasableOpen.length > 0 || appReviewSafe

    let approveReason: string | null = null
    if (open.length === 0) approveReason = 'No native human gate is currently open.'
    else if (!approveAvailable && appReviewOpen) approveReason = 'App Review approval is blocked until quality/review blockers are cleared.'

    return [
      { command_id: 'status', available: true, risk: 'low' },
      { command_id: 'quality-status', available: true, risk: 'low' },
      { command_id: 'process-audit', available: true, risk: 'low' },
      { command_id: 'claude-queue', available: true, risk: 'low' },
      {
        command_id: 'approve-gate',
        available: approveAvailable,
        risk: 'high',
        reason: approveReason,
      },
    ]
  }

  canExecute(snapshot: FactorySnapshot, request: FactoryCommandRequest): FactoryActionAvailability {
    if (request.command_id !== 'approve-gate') {
      const known = this.getAvailableCommands(snapshot).find((item) => item.command_id === request.command_id)
      return known || { command_id: request.command_id, available: false, risk: 'critical', reason: 'Unknown symbolic command.' }
    }

    const gate = String(request.arguments.gate || '')
    const nativeGate = snapshot.gates.find((item) => item.id === gate)
    if (!nativeGate || nativeGate.state !== 'open') {
      return { command_id: 'approve-gate', available: false, risk: 'high', reason: 'Requested native gate is not open.' }
    }

    const approved = (id: string) => snapshot.gates.find((item) => item.id === id)?.state === 'approved'
    const prerequisiteMap: Record<string, string[]> = {
      business_ready: ['prd_scope'],
      prd_final: ['business_ready'],
      creative_direction: ['prd_final'],
      build: ['prd_final', 'creative_direction'],
      testflight_build: ['build'],
      testflight_upload: ['testflight_build'],
      app_review_submit: ['testflight_upload'],
    }
    const missingPrerequisites = (prerequisiteMap[gate] || []).filter((id) => !approved(id))
    if (missingPrerequisites.length > 0) {
      return {
        command_id: 'approve-gate',
        available: false,
        risk: 'high',
        reason: `Prerequisite gate(s) not approved: ${missingPrerequisites.join(', ')}.`,
      }
    }

    if (gate === 'app_review_submit' && snapshot.blockers.length > 0) {
      return {
        command_id: 'approve-gate',
        available: false,
        risk: 'high',
        reason: 'App Review approval is blocked until quality/review blockers are cleared.',
      }
    }
    return { command_id: 'approve-gate', available: true, risk: 'high' }
  }

  async execute(instance: FactoryDiscoveredInstance, request: FactoryCommandRequest): Promise<FactoryCommandResult> {
    if (request.command_id !== 'approve-gate') {
      return {
        state: 'FAILED',
        before_revision: null,
        after_revision: null,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Only the symbolic approve-gate write path is enabled.',
        snapshot: null,
      }
    }

    const gate = String(request.arguments.gate || '')
    const note = typeof request.arguments.note === 'string' ? request.arguments.note.trim() : ''
    if (!GATES.includes(gate)) {
      return {
        state: 'FAILED',
        before_revision: null,
        after_revision: null,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Unknown Product Factory gate.',
        snapshot: null,
      }
    }
    if (note.length > 4000) {
      return {
        state: 'FAILED',
        before_revision: null,
        after_revision: null,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: 'Approval note exceeds 4000 characters.',
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
        error: 'Factory revision changed after the approval request was opened.',
        snapshot: before,
      }
    }

    const nativeGate = before.gates.find((item) => item.id === gate)
    if (!nativeGate || nativeGate.state !== 'open') {
      return {
        state: nativeGate?.state === 'approved' ? 'APPLIED' : 'STALE',
        before_revision: before.source.revision,
        after_revision: before.source.revision,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: nativeGate?.state === 'approved' ? null : 'Native gate is no longer open.',
        snapshot: before,
      }
    }

    const availability = this.canExecute(before, request)
    if (!availability.available) {
      return {
        state: 'FAILED',
        before_revision: before.source.revision,
        after_revision: before.source.revision,
        stdout_excerpt: '',
        stderr_excerpt: '',
        error: availability.reason || 'Native gate is blocked.',
        snapshot: before,
      }
    }

    const root = rootPath()
    const slug = assertSlug(instance.native_id)
    ensureContained(root, instance.root_path)
    const python = process.env.AI_OPS_PYTHON || 'python'
    const args = ['factory.py', 'approve', '--slug', slug, '--gate', gate]
    if (note) args.push('--note', note)

    const result = spawnSync(python, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: OUTPUT_LIMIT,
      windowsHide: true,
      shell: false,
    })
    const stdout = String(result.stdout || '').slice(-20_000)
    const stderr = String(result.stderr || '').slice(-20_000)

    if (result.error || result.status !== 0) {
      return {
        state: 'FAILED',
        before_revision: before.source.revision,
        after_revision: null,
        stdout_excerpt: stdout,
        stderr_excerpt: stderr,
        error: result.error?.message || stderr.trim() || stdout.trim() || 'Product Factory approve command failed.',
        snapshot: before,
      }
    }

    const after = await this.getSnapshot(instance)
    const confirmed = after.gates.some((item) => item.id === gate && item.state === 'approved')
    return {
      state: confirmed ? 'APPLIED' : 'UNKNOWN',
      before_revision: before.source.revision,
      after_revision: after.source.revision,
      stdout_excerpt: stdout,
      stderr_excerpt: stderr,
      error: confirmed ? null : 'Approve command returned successfully, but native gate confirmation was not observed.',
      snapshot: after,
    }
  }

  async getSnapshot(instance: FactoryDiscoveredInstance): Promise<FactorySnapshot> {
    const root = rootPath()
    const slug = assertSlug(instance.native_id)
    const projectPath = ensureContained(root, instance.root_path)
    if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) throw new Error('Product Factory project path is unavailable')

    const observedAt = new Date().toISOString()
    const [statusText, qualityText, auditText, queueText] = [
      this.readCommand(root, ['status', '--slug', slug]),
      this.readCommand(root, ['quality-status', '--slug', slug]),
      this.readCommand(root, ['process-audit', '--slug', slug]),
      this.readCommand(root, ['claude-queue', '--slug', slug]),
    ]

    const status = parseJson<NativeStatus>(statusText, 'status')
    const quality = parseJson<NativeQuality>(qualityText, 'quality-status')
    const audit = parseJson<NativeAudit>(auditText, 'process-audit')
    const queue = parseJson<NativeQueue>(queueText, 'claude-queue')

    const nativeStage = typeof status.state?.stage === 'string'
      ? String(status.state.stage)
      : typeof quality.stage === 'string' ? quality.stage : null
    const gates = buildGates(status)
    const checks = buildChecks(quality)
    const reviews = buildReviewQueue(queue)
    const failedChecks = checks.filter((check) => !check.ok)
    const pendingReviews = reviews.filter((review) => review.status.toUpperCase() === 'PENDING')
    const openGates = gates.filter((gate) => gate.state === 'open')

    const blockers = [
      ...failedChecks.map((check) => ({
        id: `check:${check.id}`,
        label: `Quality check: ${check.id}`,
        detail: check.detail || null,
        source: 'quality-status',
      })),
      ...pendingReviews.map((review) => ({
        id: `review:${review.kind}`,
        label: `Review queued: ${review.kind}`,
        detail: review.last_error || null,
        source: 'claude-queue',
      })),
    ]

    const nextActions = [
      ...openGates.map((gate) => ({
        id: `gate:${gate.id}`,
        label: `Human decision required: ${gate.id}`,
        kind: 'human_gate',
        blocking: true,
      })),
      ...pendingReviews.map((review) => ({
        id: `review:${review.kind}`,
        label: `Independent review pending: ${review.kind}`,
        kind: 'independent_review',
        blocking: true,
      })),
    ]

    const git = gitRevision(projectPath)
    const revision = sourceHash([git, status, quality, audit, queue])
    const auditVersion = String(audit.version || 'unknown')
    const processStageId = auditVersion !== 'legacy' && typeof audit.current_stage === 'string'
      ? audit.current_stage
      : null
    const warnings: string[] = []
    if (auditVersion === 'legacy') warnings.push('Legacy gate coverage: S00–S14 process stage cannot be inferred safely.')
    if (quality.all_quality_checks_pass !== true) warnings.push('Native operational stage does not imply quality readiness.')

    const snapshot: FactorySnapshot = {
      snapshot_version: '1.0',
      instance_id: instance.instance_id,
      module_id: MODULE_ID,
      observed_at: observedAt,
      source: {
        authority: root,
        native_id: slug,
        revision,
        adapter_version: '1',
      },
      freshness: {
        state: 'fresh',
        last_success_at: observedAt,
        last_error: null,
      },
      lifecycle: {
        process_stage_id: processStageId,
        native_stage: nativeStage,
        canonical_phase: canonicalPhase(nativeStage),
        status: blockers.length > 0 ? 'blocked' : quality.all_quality_checks_pass === true ? 'ready' : 'unknown',
      },
      compatibility: {
        native_version: auditVersion,
        contract_coverage: auditVersion === 'legacy' ? 'partial' : 'full',
        warnings,
      },
      gates,
      checks,
      artifacts: [
        { id: 'state', path: resolve(projectPath, '.factory', 'state.json'), exists: existsSync(resolve(projectPath, '.factory', 'state.json')) },
        { id: 'gates', path: resolve(projectPath, '.factory', 'gates.json'), exists: existsSync(resolve(projectPath, '.factory', 'gates.json')) },
        { id: 'quality_manifest', path: resolve(projectPath, 'QUALITY_MANIFEST.json'), exists: existsSync(resolve(projectPath, 'QUALITY_MANIFEST.json')) },
      ],
      review_queues: reviews,
      next_actions: nextActions,
      blockers,
      risks: [],
      metrics: [
        {
          id: 'quality_pass_rate',
          value: quality.total_count ? Number(quality.pass_count || 0) / quality.total_count : null,
          pass_count: quality.pass_count ?? null,
          total_count: quality.total_count ?? null,
          source: 'quality-status',
        },
      ],
      available_commands: [],
      raw_summary: {
        testflight_upload_status: quality.testflight_upload_status || status.state?.testflight_upload_status || null,
      },
    }
    snapshot.available_commands = this.getAvailableCommands(snapshot)
    return factorySnapshotSchema.parse(snapshot) as FactorySnapshot
  }
}

export const productFactoryAdapter = new ProductFactoryAdapter()
