// Executes an approved provision job step-by-step.
// Delegates individual step dispatch to either the provisioner daemon
// or direct sudo/command invocation depending on MC_SUPER_PROVISION_MODE.

import { getDatabase, appendProvisionEvent, logAuditEvent } from '../db'
import { getErrorMessage } from '../types/sql'
import { runCommand } from '../command'
import { runProvisionerCommand } from '../provisioner-client'
import { ProvisionStep } from './types'
import { parseJobRequest, ensureProvisionArtifacts } from './provision-utils'
import { getProvisionJob } from './tenant-queries'

interface StepResult {
  key: string
  ok: boolean
  stdout?: string
  stderr?: string
  skipped?: boolean
}

interface RunStepResult {
  stdout: string
  stderr: string
  // null is returned by runCommand when the child process exits without a code
  code: number | null
  skipped?: boolean
}

async function runProvisionStep(
  step: ProvisionStep,
  dryRun: boolean,
): Promise<RunStepResult> {
  const [command, ...args] = step.command
  if (!command) throw new Error(`Invalid command for step ${step.key}`)

  const provisionMode = String(
    process.env.MC_SUPER_PROVISION_MODE || 'daemon',
  ).toLowerCase()

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
    if (dryRun) return { stdout: '', stderr: '', code: 0, skipped: true }
    return runCommand('sudo', ['-n', command, ...args], {
      timeoutMs: step.timeout_ms || 15000,
    })
  }

  if (dryRun) return { stdout: '', stderr: '', code: 0, skipped: true }

  return runCommand(command, args, { timeoutMs: step.timeout_ms || 15000 })
}

export async function executeProvisionJob(
  jobId: number,
  actor: string,
): Promise<Record<string, unknown> | null> {
  const db = getDatabase()
  const job = getProvisionJob(jobId)
  const jobType = String(job?.job_type || 'bootstrap')
  if (!job) throw new Error('Job not found')

  if (String(job.status) !== 'approved') {
    throw new Error(
      `Job must be approved before execution. Current status: ${job.status}`,
    )
  }

  const plan = Array.isArray(job.plan_json) ? (job.plan_json as ProvisionStep[]) : []
  if (!plan.length) throw new Error('Job plan is empty')

  const dryRun = Number(job.dry_run) === 1
  const tenantRow = db
    .prepare('SELECT status FROM tenants WHERE id = ?')
    .get(job.tenant_id) as { status?: string } | undefined
  const previousTenantStatus = String(tenantRow?.status || 'pending')
  const allowExec =
    String(process.env.MC_SUPER_PROVISION_EXEC || '').toLowerCase() === 'true'
  const requestedBy = String(job.requested_by || '')
  const approvedBy = String(job.approved_by || '')
  const requested = parseJobRequest(job)
  const requestedDryRun = requested.dry_run !== false

  if (requestedDryRun !== dryRun) throw new Error('Job dry_run metadata mismatch detected')
  if (!approvedBy) throw new Error('Missing approver. Approve the job before run.')

  // Two-person integrity rule: live jobs must have a different approver and runner
  if (!dryRun) {
    if (approvedBy === requestedBy) {
      throw new Error(
        'Two-person rule violation: live jobs require an approver different from the requester.',
      )
    }
    if (approvedBy === actor) {
      throw new Error(
        'Two-person rule violation: approver cannot be the execution runner for live jobs.',
      )
    }
  }

  if (jobType === 'bootstrap') ensureProvisionArtifacts(job)

  db.prepare(`
    UPDATE provision_jobs
    SET status = 'running', started_at = (unixepoch()), updated_at = (unixepoch()), runner_host = ?
    WHERE id = ?
  `).run(process.env.HOSTNAME || 'unknown', jobId)

  const startedTenantStatus = dryRun
    ? previousTenantStatus
    : jobType === 'decommission'
      ? 'decommissioning'
      : 'provisioning'

  db.prepare(`
    UPDATE tenants SET status = ?, updated_at = (unixepoch()) WHERE id = ?
  `).run(startedTenantStatus, job.tenant_id)

  appendProvisionEvent({
    job_id: jobId,
    level: 'info',
    step_key: 'start',
    message: `Execution started by ${actor}${dryRun ? ' (dry-run)' : ''}`,
  })

  const stepResults: StepResult[] = []

  try {
    for (const step of plan) {
      appendProvisionEvent({
        job_id: jobId,
        level: 'info',
        step_key: step.key,
        message: `Running: ${step.title}`,
      })

      if (!dryRun && !allowExec) {
        throw new Error(
          'Execution disabled. Set MC_SUPER_PROVISION_EXEC=true to allow non-dry-run provisioning.',
        )
      }

      const result = await runProvisionStep(step, dryRun)
      stepResults.push({
        key: step.key,
        ok: result.code === 0,
        skipped: result.skipped || false,
        stdout: result.stdout?.slice(0, 4000),
        stderr: result.stderr?.slice(0, 4000),
      })

      if (result.skipped) {
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
      JSON.stringify({ dry_run: dryRun, steps_executed: stepResults.length, steps: stepResults }),
      jobId,
    )

    // Bootstrap/update jobs always mark the tenant active (even dry-run) so the
    // workspace lifecycle does not get stuck in 'pending'.
    const completedTenantStatus =
      jobType === 'decommission' && !dryRun ? 'suspended' : 'active'

    db.prepare(`
      UPDATE tenants SET status = ?, updated_at = (unixepoch()) WHERE id = ?
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
      target_id: job.tenant_id as number,
      detail: { job_id: jobId, dry_run: dryRun, job_type: jobType },
    })
  } catch (error: unknown) {
    const message = getErrorMessage(error) || String(error)

    db.prepare(`
      UPDATE provision_jobs
      SET status = 'failed', completed_at = (unixepoch()), error_text = ?, result_json = ?, updated_at = (unixepoch())
      WHERE id = ?
    `).run(message, JSON.stringify({ dry_run: dryRun, steps: stepResults }), jobId)

    db.prepare(`
      UPDATE tenants SET status = 'error', updated_at = (unixepoch()) WHERE id = ?
    `).run(job.tenant_id)

    appendProvisionEvent({ job_id: jobId, level: 'error', step_key: 'error', message })

    logAuditEvent({
      action: 'tenant_bootstrap_failed',
      actor,
      target_type: 'tenant',
      target_id: job.tenant_id as number,
      detail: { job_id: jobId, error: message, job_type: jobType },
    })

    throw error
  }

  return getProvisionJob(jobId)
}
