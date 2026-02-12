import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDatabase, appendProvisionEvent, logAuditEvent, Tenant, ProvisionJob } from './db'
import { runCommand } from './command'
import { runProvisionerCommand } from './provisioner-client'
import { config as appConfig } from './config'

export type TenantStatus = 'pending' | 'provisioning' | 'decommissioning' | 'active' | 'suspended' | 'error'
export type ProvisionJobStatus = 'queued' | 'approved' | 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled'
export type ProvisionJobAction = 'approve' | 'reject' | 'cancel'

export interface TenantBootstrapRequest {
  slug: string
  display_name: string
  linux_user?: string
  plan_tier?: string
  gateway_port?: number
  dashboard_port?: number
  dry_run?: boolean
  config?: Record<string, any>
  owner_gateway?: string
}

export interface TenantDecommissionRequest {
  dry_run?: boolean
  remove_linux_user?: boolean
  remove_state_dirs?: boolean
  reason?: string
}

export interface ProvisionStep {
  key: string
  title: string
  command: string[]
  requires_root: boolean
  timeout_ms?: number
}

function getTenantHomeRoot(): string {
  return String(process.env.MC_TENANT_HOME_ROOT || '/home').trim() || '/home'
}

function getTenantWorkspaceDirname(): string {
  return String(process.env.MC_TENANT_WORKSPACE_DIRNAME || 'workspace').trim() || 'workspace'
}

function joinPosix(...parts: string[]): string {
  const cleaned = parts.map((p) => String(p || '').replace(/\/+$/g, ''))
  return path.posix.join(...cleaned)
}

function normalizeSlug(input: string): string {
  return (input || '').trim().toLowerCase()
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)
}

function ensurePort(value: any): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535')
  }
  return n
}

function normalizeOwnerGateway(value: any, slug: string): string {
  const raw = String(value || '').trim()
  const fallback =
    String(process.env.MC_DEFAULT_OWNER_GATEWAY || process.env.MC_DEFAULT_GATEWAY_NAME || 'primary').trim() ||
    'primary'
  if (!raw) return fallback
  if (raw.length > 120) throw new Error('owner_gateway is too long')
  return raw
}

export function buildBootstrapPlan(tenant: {
  slug: string
  linux_user: string
  openclaw_home: string
  workspace_root: string
  gateway_port?: number | null
  dashboard_port?: number | null
}, opts: {
  templateOpenclawJsonPath: string
  gatewaySystemdTemplatePath: string
}): ProvisionStep[] {
  const artifactDir = path.join(appConfig.dataDir, 'provisioner', tenant.slug)
  const homeDir = joinPosix(getTenantHomeRoot(), tenant.linux_user)

  return [
    {
      key: 'create-linux-user',
      title: `Create linux user ${tenant.linux_user}`,
      command: ['/usr/sbin/useradd', '-m', '-s', '/bin/bash', tenant.linux_user],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'create-openclaw-state',
      title: `Create OpenClaw state directory ${tenant.openclaw_home}`,
      command: ['/usr/bin/install', '-d', '-m', '0750', '-o', tenant.linux_user, '-g', tenant.linux_user, tenant.openclaw_home],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'create-workspace-root',
      title: `Create workspace root ${tenant.workspace_root}`,
      command: ['/usr/bin/install', '-d', '-m', '0750', '-o', tenant.linux_user, '-g', tenant.linux_user, tenant.workspace_root],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'seed-openclaw-template',
      title: 'Seed base OpenClaw config scaffold',
      command: ['/usr/bin/cp', '-n', opts.templateOpenclawJsonPath, `${tenant.openclaw_home}/openclaw.json`],
      requires_root: true,
      timeout_ms: 12000,
    },
    {
      key: 'set-owner-home',
      title: `Ensure ownership of ${homeDir}`,
      command: ['/usr/bin/chown', '-R', `${tenant.linux_user}:${tenant.linux_user}`, homeDir],
      requires_root: true,
      timeout_ms: 20000,
    },
    {
      key: 'ensure-openclaw-tenants-dir',
      title: 'Ensure /etc/openclaw-tenants exists',
      command: ['/usr/bin/install', '-d', '-m', '0750', '-o', 'root', '-g', 'root', '/etc/openclaw-tenants'],
      requires_root: true,
      timeout_ms: 5000,
    },
    {
      key: 'install-gateway-systemd-template',
      title: 'Install openclaw-gateway@.service template',
      command: ['/usr/bin/cp', '-n', opts.gatewaySystemdTemplatePath, '/etc/systemd/system/openclaw-gateway@.service'],
      requires_root: true,
      timeout_ms: 5000,
    },
    {
      key: 'install-tenant-gateway-env',
      title: 'Install tenant gateway env file',
      command: ['/usr/bin/cp', '-f', `${artifactDir}/openclaw-gateway.env`, `/etc/openclaw-tenants/${tenant.linux_user}.env`],
      requires_root: true,
      timeout_ms: 5000,
    },
    {
      key: 'systemd-daemon-reload',
      title: 'Reload systemd units',
      command: ['/usr/bin/systemctl', 'daemon-reload'],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'enable-start-gateway',
      title: `Enable/start openclaw-gateway@${tenant.linux_user}.service`,
      command: ['/usr/bin/systemctl', 'enable', '--now', `openclaw-gateway@${tenant.linux_user}.service`],
      requires_root: true,
      timeout_ms: 5000,
    },
  ]
}

export function buildDecommissionPlan(tenant: {
  slug: string
  linux_user: string
  openclaw_home: string
  workspace_root: string
}, options?: {
  remove_linux_user?: boolean
  remove_state_dirs?: boolean
}): ProvisionStep[] {
  const removeLinuxUser = !!options?.remove_linux_user
  const removeStateDirs = !!options?.remove_state_dirs

  const plan: ProvisionStep[] = [
    {
      key: 'disable-stop-gateway',
      title: `Disable/stop openclaw-gateway@${tenant.linux_user}.service`,
      command: ['/usr/bin/systemctl', 'disable', '--now', `openclaw-gateway@${tenant.linux_user}.service`],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'remove-tenant-gateway-env',
      title: `Remove /etc/openclaw-tenants/${tenant.linux_user}.env`,
      command: ['/usr/bin/rm', '-f', `/etc/openclaw-tenants/${tenant.linux_user}.env`],
      requires_root: true,
      timeout_ms: 5000,
    },
  ]

  if (removeStateDirs && !removeLinuxUser) {
    plan.push(
      {
        key: 'remove-openclaw-state-dir',
        title: `Remove ${tenant.openclaw_home}`,
        command: ['/usr/bin/rm', '-rf', tenant.openclaw_home],
        requires_root: true,
        timeout_ms: 10000,
      },
      {
        key: 'remove-workspace-dir',
        title: `Remove ${tenant.workspace_root}`,
        command: ['/usr/bin/rm', '-rf', tenant.workspace_root],
        requires_root: true,
        timeout_ms: 10000,
      },
    )
  }

  if (removeLinuxUser) {
    plan.push({
      key: 'remove-linux-user',
      title: `Remove linux user ${tenant.linux_user}`,
      command: ['/usr/sbin/userdel', '-r', tenant.linux_user],
      requires_root: true,
      timeout_ms: 15000,
    })
  }

  return plan
}

function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function parseJobRequest(job: any): { dry_run?: boolean } {
  const raw = job?.request_json
  if (raw && typeof raw === 'object') return raw
  return parseJsonField(raw, {})
}

function getProvisionArtifactDir(slug: string) {
  return path.join(appConfig.dataDir, 'provisioner', slug)
}

function ensureProvisionArtifacts(job: any) {
  const requestJson = parseJobRequest(job) as any
  const slug = String(requestJson?.slug || job?.tenant_slug || '').trim()
  const linuxUser = String(job?.linux_user || '').trim()
  const openclawHome = String(job?.openclaw_home || '').trim()
  const gatewayPort = Number(requestJson?.gateway_port ?? job?.gateway_port ?? 0)

  if (!slug) throw new Error('Missing tenant slug for artifact generation')
  if (!linuxUser) throw new Error('Missing linux_user for artifact generation')
  if (!openclawHome) throw new Error('Missing openclaw_home for artifact generation')
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535) {
    throw new Error('Missing/invalid gateway_port for gateway unit provisioning')
  }

  const artifactDir = getProvisionArtifactDir(slug)
  fs.mkdirSync(artifactDir, { recursive: true })

  const gatewayEnv = [
    `TENANT_SLUG=${slug}`,
    `TENANT_USER=${linuxUser}`,
    `OPENCLAW_HOME=${openclawHome}`,
    `OPENCLAW_STATE_DIR=${openclawHome}`,
    `OPENCLAW_CONFIG_PATH=${openclawHome}/openclaw.json`,
    `OPENCLAW_GATEWAY_PORT=${gatewayPort}`,
    '',
  ].join('\n')

  fs.writeFileSync(path.join(artifactDir, 'openclaw-gateway.env'), gatewayEnv, { mode: 0o600 })
}

export function listTenants() {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT t.*, pj.id as latest_job_id, pj.status as latest_job_status, pj.created_at as latest_job_created_at
    FROM tenants t
    LEFT JOIN provision_jobs pj ON pj.id = (
      SELECT p2.id FROM provision_jobs p2 WHERE p2.tenant_id = t.id ORDER BY p2.created_at DESC, p2.id DESC LIMIT 1
    )
    ORDER BY t.created_at DESC, t.id DESC
  `).all() as Array<Tenant & { latest_job_id: number | null; latest_job_status: string | null; latest_job_created_at: number | null }>

  return rows.map((row) => ({
    ...row,
    config: parseJsonField(row.config, {}),
  }))
}

export function listProvisionJobs(filters: { tenant_id?: number; status?: string; limit?: number } = {}) {
  const db = getDatabase()
  const where: string[] = ['1=1']
  const params: any[] = []

  if (filters.tenant_id) {
    where.push('pj.tenant_id = ?')
    params.push(filters.tenant_id)
  }
  if (filters.status) {
    where.push('pj.status = ?')
    params.push(filters.status)
  }

  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500)
  params.push(limit)

  const rows = db.prepare(`
    SELECT pj.*, t.slug as tenant_slug, t.display_name as tenant_display_name
    FROM provision_jobs pj
    JOIN tenants t ON t.id = pj.tenant_id
    WHERE ${where.join(' AND ')}
    ORDER BY pj.created_at DESC, pj.id DESC
    LIMIT ?
  `).all(...params) as Array<ProvisionJob & { tenant_slug: string; tenant_display_name: string }>

  return rows.map((row) => ({
    ...row,
    request_json: parseJsonField(row.request_json, {}),
    plan_json: parseJsonField(row.plan_json, []),
    result_json: parseJsonField(row.result_json, null),
  }))
}

export function getProvisionJob(jobId: number) {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT pj.*, t.slug as tenant_slug, t.display_name as tenant_display_name, t.linux_user, t.openclaw_home, t.workspace_root
    FROM provision_jobs pj
    JOIN tenants t ON t.id = pj.tenant_id
    WHERE pj.id = ?
  `).get(jobId) as any

  if (!row) return null

  const events = db.prepare(`
    SELECT * FROM provision_events WHERE job_id = ? ORDER BY created_at ASC, id ASC
  `).all(jobId)

  return {
    ...row,
    request_json: parseJsonField(row.request_json, {}),
    plan_json: parseJsonField(row.plan_json, []),
    result_json: parseJsonField(row.result_json, null),
    events,
  }
}

export function createTenantAndBootstrapJob(request: TenantBootstrapRequest, actor: string) {
  const db = getDatabase()

  const templateOpenclawJsonPath =
    String(process.env.MC_SUPER_TEMPLATE_OPENCLAW_JSON || (process.env.OPENCLAW_HOME ? path.join(process.env.OPENCLAW_HOME, 'openclaw.json') : '')).trim()
  if (!templateOpenclawJsonPath) {
    throw new Error('Missing OpenClaw template config. Set MC_SUPER_TEMPLATE_OPENCLAW_JSON to an openclaw.json to seed new tenants.')
  }

  const repoRoot = String(process.env.MISSION_CONTROL_REPO_ROOT || process.cwd()).trim() || process.cwd()
  const gatewaySystemdTemplatePath = path.join(repoRoot, 'ops', 'templates', 'openclaw-gateway@.service')

  const slug = normalizeSlug(request.slug)
  if (!isValidSlug(slug)) {
    throw new Error('Invalid slug. Use lowercase letters, numbers, and dashes (3-32 chars).')
  }

  const displayName = (request.display_name || '').trim()
  if (!displayName) {
    throw new Error('display_name is required')
  }

  const linuxUser = (request.linux_user || `oc-${slug}`).trim().toLowerCase()
  if (!/^[a-z_][a-z0-9_-]{1,30}$/.test(linuxUser)) {
    throw new Error('Invalid linux_user format')
  }

  const gatewayPort = ensurePort(request.gateway_port)
  const dashboardPort = ensurePort(request.dashboard_port)
  const planTier = (request.plan_tier || 'standard').trim().toLowerCase()
  const config = request.config || {}
  const dryRun = request.dry_run !== false
  const ownerGateway = normalizeOwnerGateway((request as any).owner_gateway, slug)

  if (!gatewayPort) {
    throw new Error('gateway_port is required for tenant bootstrap')
  }

  const tenantHomeRoot = getTenantHomeRoot()
  const workspaceDirname = getTenantWorkspaceDirname()
  const openclawHome = joinPosix(tenantHomeRoot, linuxUser, '.openclaw')
  const workspaceRoot = joinPosix(tenantHomeRoot, linuxUser, workspaceDirname)

  const inserted = db.transaction(() => {
    const tenantRes = db.prepare(`
      INSERT INTO tenants (slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, gateway_port, dashboard_port, config, created_by, owner_gateway)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug,
      displayName,
      linuxUser,
      planTier,
      openclawHome,
      workspaceRoot,
      gatewayPort,
      dashboardPort,
      JSON.stringify(config),
      actor,
      ownerGateway
    )

    const tenantId = Number(tenantRes.lastInsertRowid)

    const plan = buildBootstrapPlan({
      slug,
      linux_user: linuxUser,
      openclaw_home: openclawHome,
      workspace_root: workspaceRoot,
      gateway_port: gatewayPort,
      dashboard_port: dashboardPort,
    }, {
      templateOpenclawJsonPath,
      gatewaySystemdTemplatePath,
    })

    const requestPayload = {
      slug,
      display_name: displayName,
      linux_user: linuxUser,
      gateway_port: gatewayPort,
      dashboard_port: dashboardPort,
      plan_tier: planTier,
      dry_run: dryRun,
      config,
      owner_gateway: ownerGateway,
    }

    const jobRes = db.prepare(`
      INSERT INTO provision_jobs (tenant_id, job_type, status, dry_run, requested_by, idempotency_key, request_json, plan_json, updated_at)
      VALUES (?, 'bootstrap', 'queued', ?, ?, ?, ?, ?, (unixepoch()))
    `).run(
      tenantId,
      dryRun ? 1 : 0,
      actor,
      randomUUID(),
      JSON.stringify(requestPayload),
      JSON.stringify(plan),
    )

    return {
      tenant_id: tenantId,
      job_id: Number(jobRes.lastInsertRowid),
    }
  })()

  appendProvisionEvent({
    job_id: inserted.job_id,
    level: 'info',
    step_key: 'queued',
    message: `Provisioning request queued (${dryRun ? 'dry-run' : 'execute'})`,
    data: { actor },
  })

  logAuditEvent({
    action: 'tenant_bootstrap_requested',
    actor,
    target_type: 'tenant',
    target_id: inserted.tenant_id,
    detail: { dry_run: dryRun, slug, linux_user: linuxUser, owner_gateway: ownerGateway },
  })

  return {
    tenant: db.prepare('SELECT * FROM tenants WHERE id = ?').get(inserted.tenant_id),
    job: getProvisionJob(inserted.job_id),
  }
}

export function createTenantDecommissionJob(tenantId: number, request: TenantDecommissionRequest, actor: string) {
  const db = getDatabase()

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error('Invalid tenant id')
  }

  const tenant = db.prepare(`
    SELECT * FROM tenants WHERE id = ?
  `).get(tenantId) as Tenant | undefined

  if (!tenant) {
    throw new Error('Tenant not found')
  }

  const dryRun = request.dry_run !== false
  const removeLinuxUser = !!request.remove_linux_user
  const removeStateDirs = !!request.remove_state_dirs
  const reason = String(request.reason || '').trim()

  const plan = buildDecommissionPlan({
    slug: tenant.slug,
    linux_user: tenant.linux_user,
    openclaw_home: tenant.openclaw_home,
    workspace_root: tenant.workspace_root,
  }, {
    remove_linux_user: removeLinuxUser,
    remove_state_dirs: removeStateDirs,
  })

  const requestPayload = {
    tenant_id: tenant.id,
    slug: tenant.slug,
    linux_user: tenant.linux_user,
    dry_run: dryRun,
    remove_linux_user: removeLinuxUser,
    remove_state_dirs: removeStateDirs,
    reason: reason || null,
  }

  const jobRes = db.prepare(`
    INSERT INTO provision_jobs (tenant_id, job_type, status, dry_run, requested_by, idempotency_key, request_json, plan_json, updated_at)
    VALUES (?, 'decommission', 'queued', ?, ?, ?, ?, ?, (unixepoch()))
  `).run(
    tenant.id,
    dryRun ? 1 : 0,
    actor,
    randomUUID(),
    JSON.stringify(requestPayload),
    JSON.stringify(plan),
  )

  const jobId = Number(jobRes.lastInsertRowid)

  appendProvisionEvent({
    job_id: jobId,
    level: 'warn',
    step_key: 'queued',
    message: `Decommission request queued (${dryRun ? 'dry-run' : 'execute'})`,
    data: { actor, reason: reason || null, remove_linux_user: removeLinuxUser, remove_state_dirs: removeStateDirs },
  })

  logAuditEvent({
    action: 'tenant_decommission_requested',
    actor,
    target_type: 'tenant',
    target_id: tenant.id,
    detail: { job_id: jobId, dry_run: dryRun, remove_linux_user: removeLinuxUser, remove_state_dirs: removeStateDirs },
  })

  return { tenant, job: getProvisionJob(jobId) }
}

export function transitionProvisionJobStatus(
  jobId: number,
  actor: string,
  action: ProvisionJobAction,
  reason?: string
) {
  const db = getDatabase()
  const job = getProvisionJob(jobId)
  if (!job) throw new Error('Job not found')

  const currentStatus = String(job.status)
  const normalizedReason = (reason || '').trim()

  if (['running', 'completed', 'cancelled'].includes(currentStatus)) {
    throw new Error(`Job status ${currentStatus} is immutable`)
  }

  if (action === 'approve') {
    if (!['queued', 'rejected', 'failed'].includes(currentStatus)) {
      throw new Error(`Cannot approve job from status ${currentStatus}`)
    }

    db.prepare(`
      UPDATE provision_jobs
      SET status = 'approved', approved_by = ?, error_text = NULL, updated_at = (unixepoch())
      WHERE id = ?
    `).run(actor, jobId)

    appendProvisionEvent({
      job_id: jobId,
      level: 'info',
      step_key: 'approval',
      message: `Approved by ${actor}${normalizedReason ? `: ${normalizedReason}` : ''}`,
      data: { actor, reason: normalizedReason || null },
    })

    logAuditEvent({
      action: 'provision_job_approved',
      actor,
      target_type: 'tenant',
      target_id: job.tenant_id,
      detail: { job_id: jobId, reason: normalizedReason || null },
    })
  } else if (action === 'reject') {
    if (!['queued', 'approved', 'failed'].includes(currentStatus)) {
      throw new Error(`Cannot reject job from status ${currentStatus}`)
    }
    db.prepare(`
      UPDATE provision_jobs
      SET status = 'rejected', updated_at = (unixepoch())
      WHERE id = ?
    `).run(jobId)

    appendProvisionEvent({
      job_id: jobId,
      level: 'warn',
      step_key: 'approval',
      message: `Rejected by ${actor}${normalizedReason ? `: ${normalizedReason}` : ''}`,
      data: { actor, reason: normalizedReason || null },
    })

    logAuditEvent({
      action: 'provision_job_rejected',
      actor,
      target_type: 'tenant',
      target_id: job.tenant_id,
      detail: { job_id: jobId, reason: normalizedReason || null },
    })
  } else if (action === 'cancel') {
    if (!['queued', 'approved', 'failed', 'rejected'].includes(currentStatus)) {
      throw new Error(`Cannot cancel job from status ${currentStatus}`)
    }
    db.prepare(`
      UPDATE provision_jobs
      SET status = 'cancelled', completed_at = (unixepoch()), updated_at = (unixepoch())
      WHERE id = ?
    `).run(jobId)

    appendProvisionEvent({
      job_id: jobId,
      level: 'warn',
      step_key: 'cancel',
      message: `Cancelled by ${actor}${normalizedReason ? `: ${normalizedReason}` : ''}`,
      data: { actor, reason: normalizedReason || null },
    })

    logAuditEvent({
      action: 'provision_job_cancelled',
      actor,
      target_type: 'tenant',
      target_id: job.tenant_id,
      detail: { job_id: jobId, reason: normalizedReason || null },
    })
  } else {
    throw new Error(`Unsupported action: ${action}`)
  }

  return getProvisionJob(jobId)
}

async function runProvisionStep(step: ProvisionStep, dryRun: boolean) {
  const [command, ...args] = step.command
  if (!command) throw new Error(`Invalid command for step ${step.key}`)

  const provisionMode = String(process.env.MC_SUPER_PROVISION_MODE || 'daemon').toLowerCase()

  if (step.requires_root && provisionMode === 'daemon') {
    return runProvisionerCommand({
      command,
      args,
      timeoutMs: step.timeout_ms || 15000,
      dryRun,
      stepKey: step.key,
    })
  }

  if (step.requires_root) {
    if (dryRun) {
      return {
        stdout: '',
        stderr: '',
        code: 0,
        skipped: true,
      }
    }
    return runCommand('sudo', ['-n', command, ...args], { timeoutMs: step.timeout_ms || 15000 })
  }

  if (dryRun) {
    return {
      stdout: '',
      stderr: '',
      code: 0,
      skipped: true,
    }
  }

  return runCommand(command, args, {
    timeoutMs: step.timeout_ms || 15000,
  })
}

export async function executeProvisionJob(jobId: number, actor: string) {
  const db = getDatabase()
  const job = getProvisionJob(jobId)
  const jobType = String(job?.job_type || 'bootstrap')
  if (!job) throw new Error('Job not found')

  if (String(job.status) !== 'approved') {
    throw new Error(`Job must be approved before execution. Current status: ${job.status}`)
  }

  const plan = Array.isArray(job.plan_json) ? (job.plan_json as ProvisionStep[]) : []
  if (!plan.length) throw new Error('Job plan is empty')

  const dryRun = Number(job.dry_run) === 1
  const tenantRow = db.prepare('SELECT status FROM tenants WHERE id = ?').get(job.tenant_id) as { status?: string } | undefined
  const previousTenantStatus = String(tenantRow?.status || 'pending')
  const allowExec = String(process.env.MC_SUPER_PROVISION_EXEC || '').toLowerCase() === 'true'
  const requestedBy = String(job.requested_by || '')
  const approvedBy = String(job.approved_by || '')
  const requested = parseJobRequest(job)
  const requestedDryRun = requested.dry_run !== false
  if (requestedDryRun !== dryRun) {
    throw new Error('Job dry_run metadata mismatch detected')
  }

  if (!approvedBy) {
    throw new Error('Missing approver. Approve the job before run.')
  }

  if (!dryRun) {
    if (approvedBy === requestedBy) {
      throw new Error('Two-person rule violation: live jobs require an approver different from the requester.')
    }
    if (approvedBy === actor) {
      throw new Error('Two-person rule violation: approver cannot be the execution runner for live jobs.')
    }
  }

  if (jobType === 'bootstrap') {
    ensureProvisionArtifacts(job)
  }

  db.prepare(`
    UPDATE provision_jobs
    SET status = 'running', started_at = (unixepoch()), updated_at = (unixepoch()), runner_host = ?
    WHERE id = ?
  `).run(process.env.HOSTNAME || 'unknown', jobId)

  const startedTenantStatus = dryRun
    ? previousTenantStatus
    : (jobType === 'decommission' ? 'decommissioning' : 'provisioning')
  db.prepare(`
    UPDATE tenants
    SET status = ?, updated_at = (unixepoch())
    WHERE id = ?
  `).run(startedTenantStatus, job.tenant_id)

  appendProvisionEvent({
    job_id: jobId,
    level: 'info',
    step_key: 'start',
    message: `Execution started by ${actor}${dryRun ? ' (dry-run)' : ''}`,
  })

  const stepResults: Array<{ key: string; ok: boolean; stdout?: string; stderr?: string; skipped?: boolean }> = []

  try {
    for (const step of plan) {
      appendProvisionEvent({
        job_id: jobId,
        level: 'info',
        step_key: step.key,
        message: `Running: ${step.title}`,
      })

      if (!dryRun && !allowExec) {
        throw new Error('Execution disabled. Set MC_SUPER_PROVISION_EXEC=true to allow non-dry-run provisioning.')
      }

      const result = await runProvisionStep(step, dryRun)
      stepResults.push({
        key: step.key,
        ok: result.code === 0,
        skipped: (result as any)?.skipped || false,
        stdout: result.stdout?.slice(0, 4000),
        stderr: result.stderr?.slice(0, 4000),
      })

      if ((result as any)?.skipped) {
        appendProvisionEvent({
          job_id: jobId,
          level: 'info',
          step_key: step.key,
          message: 'Dry-run: command execution skipped',
          data: { command: step.command, requires_root: step.requires_root },
        })
        continue
      }

      appendProvisionEvent({
        job_id: jobId,
        level: 'info',
        step_key: step.key,
        message: 'Completed',
        data: {
          code: result.code,
          stdout_preview: result.stdout?.slice(0, 250),
          stderr_preview: result.stderr?.slice(0, 250),
        },
      })
    }

    db.prepare(`
      UPDATE provision_jobs
      SET status = 'completed', completed_at = (unixepoch()), result_json = ?, error_text = NULL, updated_at = (unixepoch())
      WHERE id = ?
    `).run(
      JSON.stringify({
        dry_run: dryRun,
        steps_executed: stepResults.length,
        steps: stepResults,
      }),
      jobId,
    )

    const completedTenantStatus = dryRun
      ? previousTenantStatus
      : (jobType === 'decommission' ? 'suspended' : 'active')
    db.prepare(`
      UPDATE tenants
      SET status = ?, updated_at = (unixepoch())
      WHERE id = ?
    `).run(completedTenantStatus, job.tenant_id)

    appendProvisionEvent({
      job_id: jobId,
      level: 'info',
      step_key: 'finish',
      message: `${jobType} job completed (${dryRun ? 'dry-run' : 'execute'})`,
    })

    logAuditEvent({
      action: 'tenant_bootstrap_completed',
      actor,
      target_type: 'tenant',
      target_id: job.tenant_id,
      detail: { job_id: jobId, dry_run: dryRun, job_type: jobType },
    })
  } catch (error: any) {
    const message = error?.message || String(error)

    db.prepare(`
      UPDATE provision_jobs
      SET status = 'failed', completed_at = (unixepoch()), error_text = ?, result_json = ?, updated_at = (unixepoch())
      WHERE id = ?
    `).run(
      message,
      JSON.stringify({ dry_run: dryRun, steps: stepResults }),
      jobId,
    )

    db.prepare(`
      UPDATE tenants
      SET status = 'error', updated_at = (unixepoch())
      WHERE id = ?
    `).run(job.tenant_id)

    appendProvisionEvent({
      job_id: jobId,
      level: 'error',
      step_key: 'error',
      message,
    })

    logAuditEvent({
      action: 'tenant_bootstrap_failed',
      actor,
      target_type: 'tenant',
      target_id: job.tenant_id,
      detail: { job_id: jobId, error: message, job_type: jobType },
    })

    throw error
  }

  return getProvisionJob(jobId)
}
