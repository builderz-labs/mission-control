// Write operations: create tenants, queue provision jobs, transition job status.
// All mutations go through the DB transaction layer and emit audit events.

import path from 'path'
import { randomUUID } from 'crypto'
import { getDatabase, appendProvisionEvent, logAuditEvent, Tenant } from '../db'
import { TenantBootstrapRequest, TenantDecommissionRequest, ProvisionJobAction } from './types'
import { buildBootstrapPlan, buildDecommissionPlan } from './provision-plans'
import {
  normalizeSlug,
  isValidSlug,
  ensurePort,
  normalizeOwnerGateway,
  getTenantHomeRoot,
  getTenantWorkspaceDirname,
  joinPosix,
} from './provision-utils'
import { getProvisionJob } from './tenant-queries'

// ---------------------------------------------------------------------------
// Tenant + bootstrap job creation
// ---------------------------------------------------------------------------

export function createTenantAndBootstrapJob(
  request: TenantBootstrapRequest,
  actor: string,
): { tenant: unknown; job: Record<string, unknown> | null } {
  const db = getDatabase()

  const templateOpenclawJsonPath = String(
    process.env.MC_SUPER_TEMPLATE_OPENCLAW_JSON ||
      (process.env.OPENCLAW_HOME
        ? path.join(process.env.OPENCLAW_HOME, 'openclaw.json')
        : ''),
  ).trim()
  if (!templateOpenclawJsonPath) {
    throw new Error(
      'Missing OpenClaw template config. Set MC_SUPER_TEMPLATE_OPENCLAW_JSON to an openclaw.json to seed new tenants.',
    )
  }

  const repoRoot =
    String(process.env.MISSION_CONTROL_REPO_ROOT || process.cwd()).trim() || process.cwd()
  const gatewaySystemdTemplatePath = path.join(
    repoRoot,
    'ops',
    'templates',
    'openclaw-gateway@.service',
  )

  const slug = normalizeSlug(request.slug)
  if (!isValidSlug(slug)) {
    throw new Error('Invalid slug. Use lowercase letters, numbers, and dashes (3-32 chars).')
  }

  const displayName = (request.display_name || '').trim()
  if (!displayName) throw new Error('display_name is required')

  const linuxUser = (request.linux_user || `oc-${slug}`).trim().toLowerCase()
  if (!/^[a-z_][a-z0-9_-]{1,30}$/.test(linuxUser)) {
    throw new Error('Invalid linux_user format')
  }

  const gatewayPort = ensurePort(request.gateway_port)
  const dashboardPort = ensurePort(request.dashboard_port)
  const planTier = (request.plan_tier || 'standard').trim().toLowerCase()
  const config = request.config || {}
  const dryRun = request.dry_run !== false
  const ownerGateway = normalizeOwnerGateway(
    (request as unknown as Record<string, unknown>).owner_gateway,
    slug,
  )

  if (!gatewayPort) throw new Error('gateway_port is required for tenant bootstrap')

  const tenantHomeRoot = getTenantHomeRoot()
  const workspaceDirname = getTenantWorkspaceDirname()
  const openclawHome = joinPosix(tenantHomeRoot, linuxUser, '.openclaw')
  const workspaceRoot = joinPosix(tenantHomeRoot, linuxUser, workspaceDirname)

  const inserted = db.transaction(() => {
    const tenantRes = db
      .prepare(`
        INSERT INTO tenants (slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, gateway_port, dashboard_port, config, created_by, owner_gateway)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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
        ownerGateway,
      )

    const tenantId = Number(tenantRes.lastInsertRowid)

    const plan = buildBootstrapPlan(
      {
        slug,
        linux_user: linuxUser,
        openclaw_home: openclawHome,
        workspace_root: workspaceRoot,
        gateway_port: gatewayPort,
        dashboard_port: dashboardPort,
      },
      { templateOpenclawJsonPath, gatewaySystemdTemplatePath },
    )

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

    const jobRes = db
      .prepare(`
        INSERT INTO provision_jobs (tenant_id, job_type, status, dry_run, requested_by, idempotency_key, request_json, plan_json, updated_at)
        VALUES (?, 'bootstrap', 'queued', ?, ?, ?, ?, ?, (unixepoch()))
      `)
      .run(
        tenantId,
        dryRun ? 1 : 0,
        actor,
        randomUUID(),
        JSON.stringify(requestPayload),
        JSON.stringify(plan),
      )

    return { tenant_id: tenantId, job_id: Number(jobRes.lastInsertRowid) }
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
    tenant: db
      .prepare(
        'SELECT id, slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, gateway_port, dashboard_port, config, created_by, created_at, updated_at FROM tenants WHERE id = ?',
      )
      .get(inserted.tenant_id),
    job: getProvisionJob(inserted.job_id),
  }
}

// ---------------------------------------------------------------------------
// Tenant decommission job creation
// ---------------------------------------------------------------------------

export function createTenantDecommissionJob(
  tenantId: number,
  request: TenantDecommissionRequest,
  actor: string,
): { tenant: Tenant; job: Record<string, unknown> | null } {
  const db = getDatabase()

  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error('Invalid tenant id')

  const tenant = db
    .prepare(`
      SELECT id, slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, gateway_port, dashboard_port, config, created_by, created_at, updated_at FROM tenants WHERE id = ?
    `)
    .get(tenantId) as Tenant | undefined

  if (!tenant) throw new Error('Tenant not found')

  const dryRun = request.dry_run !== false
  const removeLinuxUser = !!request.remove_linux_user
  const removeStateDirs = !!request.remove_state_dirs
  const reason = String(request.reason || '').trim()

  const plan = buildDecommissionPlan(
    {
      slug: tenant.slug,
      linux_user: tenant.linux_user,
      openclaw_home: tenant.openclaw_home,
      workspace_root: tenant.workspace_root,
    },
    { remove_linux_user: removeLinuxUser, remove_state_dirs: removeStateDirs },
  )

  const requestPayload = {
    tenant_id: tenant.id,
    slug: tenant.slug,
    linux_user: tenant.linux_user,
    dry_run: dryRun,
    remove_linux_user: removeLinuxUser,
    remove_state_dirs: removeStateDirs,
    reason: reason || null,
  }

  const jobRes = db
    .prepare(`
      INSERT INTO provision_jobs (tenant_id, job_type, status, dry_run, requested_by, idempotency_key, request_json, plan_json, updated_at)
      VALUES (?, 'decommission', 'queued', ?, ?, ?, ?, ?, (unixepoch()))
    `)
    .run(
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
    data: {
      actor,
      reason: reason || null,
      remove_linux_user: removeLinuxUser,
      remove_state_dirs: removeStateDirs,
    },
  })

  logAuditEvent({
    action: 'tenant_decommission_requested',
    actor,
    target_type: 'tenant',
    target_id: tenant.id,
    detail: {
      job_id: jobId,
      dry_run: dryRun,
      remove_linux_user: removeLinuxUser,
      remove_state_dirs: removeStateDirs,
    },
  })

  return { tenant, job: getProvisionJob(jobId) }
}

// ---------------------------------------------------------------------------
// Job status transitions (approve / reject / cancel)
// ---------------------------------------------------------------------------

export function transitionProvisionJobStatus(
  jobId: number,
  actor: string,
  action: ProvisionJobAction,
  reason?: string,
): Record<string, unknown> | null {
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
      target_id: job.tenant_id as number,
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
      target_id: job.tenant_id as number,
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
      target_id: job.tenant_id as number,
      detail: { job_id: jobId, reason: normalizedReason || null },
    })
  } else {
    throw new Error(`Unsupported action: ${action}`)
  }

  return getProvisionJob(jobId)
}
