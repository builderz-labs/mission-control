import type Database from 'better-sqlite3'
import { writeTransaction } from './db'
import { eventBus } from './event-bus'
import { logger } from './logger'

// ── Types ──

export interface WorkflowPhaseRow {
  id: number
  template_id: number
  name: string
  phase_order: number
  agent_role: string | null
  input_schema: string | null
  output_schema: string | null
  requires_approval: number
  description: string | null
}

export interface WorkflowRunRow {
  id: number
  template_id: number
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  current_phase_id: number | null
  input_data: string | null
  started_at: number | null
  completed_at: number | null
  workspace_id: number
  created_by: string
  created_at: number
  updated_at: number
}

export interface WorkflowPhaseRunRow {
  id: number
  run_id: number
  phase_id: number
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'rejected'
  input_artifact: string | null
  output_artifact: string | null
  validation_error: string | null
  approved_by: string | null
  approved_at: number | null
  started_at: number | null
  completed_at: number | null
}

// ── Create Run ──

export function createWorkflowRun(
  db: Database.Database,
  templateId: number,
  inputData: string | null,
  createdBy: string,
  workspaceId: number
): { runId: number } {
  return writeTransaction(db, (txDb) => {
    const template = txDb.prepare('SELECT id, name FROM workflow_templates WHERE id = ?').get(templateId) as { id: number; name: string } | undefined
    if (!template) throw new Error(`Template ${templateId} not found`)

    const phases = txDb.prepare(
      'SELECT * FROM workflow_phases WHERE template_id = ? ORDER BY phase_order ASC'
    ).all(templateId) as WorkflowPhaseRow[]

    if (phases.length === 0) throw new Error(`Template ${templateId} has no phases`)

    const result = txDb.prepare(`
      INSERT INTO workflow_runs (template_id, status, current_phase_id, input_data, started_at, workspace_id, created_by)
      VALUES (?, 'running', ?, ?, unixepoch(), ?, ?)
    `).run(templateId, phases[0].id, inputData, workspaceId, createdBy)

    const runId = Number(result.lastInsertRowid)

    const insertPhaseRun = txDb.prepare(`
      INSERT INTO workflow_phase_runs (run_id, phase_id, status, input_artifact, started_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    insertPhaseRun.run(runId, phases[0].id, 'running', inputData, Math.floor(Date.now() / 1000))
    for (let i = 1; i < phases.length; i++) {
      insertPhaseRun.run(runId, phases[i].id, 'pending', null, null)
    }

    // WKFL-06: Create task in task board for the first running phase
    createTaskForPhase(txDb, runId, phases[0], workspaceId)

    eventBus.broadcast('workflow.run.started', {
      runId,
      workflowId: templateId,
      templateName: template.name,
    })

    return { runId }
  })
}

// ── Complete Phase ──

export function completePhase(
  db: Database.Database,
  runId: number,
  phaseRunId: number,
  outputArtifact: string
): { status: string; validationError?: string } {
  return writeTransaction(db, (txDb) => {
    const phaseRun = txDb.prepare(
      'SELECT * FROM workflow_phase_runs WHERE id = ? AND run_id = ?'
    ).get(phaseRunId, runId) as WorkflowPhaseRunRow | undefined

    if (!phaseRun) throw new Error('Phase run not found')
    if (phaseRun.status !== 'running') throw new Error(`Phase is ${phaseRun.status}, expected running`)

    const phaseDef = txDb.prepare('SELECT * FROM workflow_phases WHERE id = ?').get(phaseRun.phase_id) as WorkflowPhaseRow | undefined
    if (!phaseDef) throw new Error('Phase definition not found')

    if (phaseDef.output_schema) {
      try {
        const schema = JSON.parse(phaseDef.output_schema)
        const output = JSON.parse(outputArtifact)

        if (schema.required && Array.isArray(schema.required)) {
          for (const field of schema.required) {
            if (!(field in output)) {
              const error = `Missing required field: ${field}`
              txDb.prepare('UPDATE workflow_phase_runs SET validation_error = ? WHERE id = ?').run(error, phaseRunId)
              return { status: 'validation_error', validationError: error }
            }
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Schema validation failed'
        txDb.prepare('UPDATE workflow_phase_runs SET validation_error = ? WHERE id = ?').run(error, phaseRunId)
        return { status: 'validation_error', validationError: error }
      }
    }

    txDb.prepare(`
      UPDATE workflow_phase_runs
      SET status = 'completed', output_artifact = ?, completed_at = unixepoch()
      WHERE id = ?
    `).run(outputArtifact, phaseRunId)

    return { status: 'completed' }
  })
}

// ── Advance Workflow ──

export function advanceWorkflow(
  db: Database.Database,
  runId: number
): { status: string; nextPhase?: { id: number; name: string; requiresApproval: boolean } } {
  return writeTransaction(db, (txDb) => {
    const run = txDb.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId) as WorkflowRunRow | undefined
    if (!run) throw new Error('Run not found')
    if (run.status !== 'running') throw new Error(`Run is ${run.status}, expected running`)

    const phases = txDb.prepare(
      'SELECT * FROM workflow_phases WHERE template_id = ? ORDER BY phase_order ASC'
    ).all(run.template_id) as WorkflowPhaseRow[]

    const phaseRuns = txDb.prepare(
      'SELECT * FROM workflow_phase_runs WHERE run_id = ?'
    ).all(runId) as WorkflowPhaseRunRow[]

    const currentPhaseRun = phaseRuns.find((pr) => pr.phase_id === run.current_phase_id)
    if (!currentPhaseRun || currentPhaseRun.status !== 'completed') {
      throw new Error('Current phase is not completed')
    }

    const currentPhaseDef = phases.find((p) => p.id === run.current_phase_id)
    if (!currentPhaseDef) throw new Error('Current phase definition not found')

    const currentIndex = phases.findIndex((p) => p.id === run.current_phase_id)
    const nextPhaseDef = phases[currentIndex + 1]

    if (!nextPhaseDef) {
      txDb.prepare(`
        UPDATE workflow_runs SET status = 'completed', completed_at = unixepoch(), updated_at = unixepoch()
        WHERE id = ?
      `).run(runId)

      eventBus.broadcast('workflow.run.completed', { runId, status: 'completed' })
      return { status: 'completed' }
    }

    const nextPhaseRun = phaseRuns.find((pr) => pr.phase_id === nextPhaseDef.id)
    if (!nextPhaseRun) throw new Error('Next phase run not found')

    const inputArtifact = currentPhaseRun.output_artifact

    if (nextPhaseDef.requires_approval) {
      txDb.prepare(`
        UPDATE workflow_phase_runs
        SET status = 'paused', input_artifact = ?, started_at = unixepoch()
        WHERE id = ?
      `).run(inputArtifact, nextPhaseRun.id)

      txDb.prepare(`
        UPDATE workflow_runs SET current_phase_id = ?, status = 'paused', updated_at = unixepoch()
        WHERE id = ?
      `).run(nextPhaseDef.id, runId)

      eventBus.broadcast('workflow.phase.approval_required', {
        runId,
        phaseId: nextPhaseDef.id,
        phaseName: nextPhaseDef.name,
      })

      return {
        status: 'paused',
        nextPhase: { id: nextPhaseDef.id, name: nextPhaseDef.name, requiresApproval: true },
      }
    }

    txDb.prepare(`
      UPDATE workflow_phase_runs
      SET status = 'running', input_artifact = ?, started_at = unixepoch()
      WHERE id = ?
    `).run(inputArtifact, nextPhaseRun.id)

    txDb.prepare(`
      UPDATE workflow_runs SET current_phase_id = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(nextPhaseDef.id, runId)

    // WKFL-06: Create task in task board for the newly running phase
    createTaskForPhase(txDb, runId, nextPhaseDef, run.workspace_id)

    eventBus.broadcast('workflow.phase.transition', {
      runId,
      fromPhase: currentPhaseDef.name,
      toPhase: nextPhaseDef.name,
    })

    return {
      status: 'running',
      nextPhase: { id: nextPhaseDef.id, name: nextPhaseDef.name, requiresApproval: false },
    }
  })
}

// ── Approve Phase ──

export function approvePhase(
  db: Database.Database,
  runId: number,
  phaseRunId: number,
  approvedBy: string
): { status: string } {
  return writeTransaction(db, (txDb) => {
    const phaseRun = txDb.prepare(
      'SELECT * FROM workflow_phase_runs WHERE id = ? AND run_id = ?'
    ).get(phaseRunId, runId) as WorkflowPhaseRunRow | undefined

    if (!phaseRun) throw new Error('Phase run not found')
    if (phaseRun.status !== 'paused') throw new Error(`Phase is ${phaseRun.status}, expected paused`)

    txDb.prepare(`
      UPDATE workflow_phase_runs
      SET status = 'running', approved_by = ?, approved_at = unixepoch()
      WHERE id = ?
    `).run(approvedBy, phaseRunId)

    txDb.prepare(`
      UPDATE workflow_runs SET status = 'running', updated_at = unixepoch()
      WHERE id = ?
    `).run(runId)

    const phaseDef = txDb.prepare('SELECT name FROM workflow_phases WHERE id = ?').get(phaseRun.phase_id) as { name: string } | undefined
    logger.info(`Phase ${phaseDef?.name || phaseRun.phase_id} approved by ${approvedBy} for run ${runId}`)

    return { status: 'running' }
  })
}

// ── Reject Phase ──

export function rejectPhase(
  db: Database.Database,
  runId: number,
  phaseRunId: number,
  reason: string
): { status: string } {
  return writeTransaction(db, (txDb) => {
    const phaseRun = txDb.prepare(
      'SELECT * FROM workflow_phase_runs WHERE id = ? AND run_id = ?'
    ).get(phaseRunId, runId) as WorkflowPhaseRunRow | undefined

    if (!phaseRun) throw new Error('Phase run not found')
    if (phaseRun.status !== 'paused') throw new Error(`Phase is ${phaseRun.status}, expected paused`)

    txDb.prepare(`
      UPDATE workflow_phase_runs
      SET status = 'rejected', validation_error = ?, completed_at = unixepoch()
      WHERE id = ?
    `).run(reason, phaseRunId)

    txDb.prepare(`
      UPDATE workflow_runs SET status = 'failed', completed_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?
    `).run(runId)

    eventBus.broadcast('workflow.run.completed', { runId, status: 'failed' })

    return { status: 'failed' }
  })
}

// ── Task Board Integration (WKFL-06) ──

function createTaskForPhase(
  db: Database.Database,
  runId: number,
  phase: WorkflowPhaseRow,
  workspaceId: number
): void {
  db.prepare(`
    INSERT INTO tasks (title, description, status, priority, assigned_to, created_by, workspace_id, metadata)
    VALUES (?, ?, 'in_progress', 'medium', ?, 'workflow-engine', ?, ?)
  `).run(
    `[Workflow] ${phase.name}`,
    phase.description || `Workflow phase: ${phase.name}`,
    phase.agent_role,
    workspaceId,
    JSON.stringify({ workflow_run_id: runId, workflow_phase_id: phase.id })
  )

  eventBus.broadcast('task.created', {
    workspaceId,
    source: 'workflow-engine',
  })
}

// ── Get Run Status ──

export function getWorkflowRunStatus(
  db: Database.Database,
  runId: number
): { run: WorkflowRunRow; phases: (WorkflowPhaseRunRow & { phase_name: string; phase_order: number })[] } | null {
  const run = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId) as WorkflowRunRow | undefined
  if (!run) return null

  const phases = db.prepare(`
    SELECT pr.*, p.name as phase_name, p.phase_order
    FROM workflow_phase_runs pr
    JOIN workflow_phases p ON pr.phase_id = p.id
    WHERE pr.run_id = ?
    ORDER BY p.phase_order ASC
  `).all(runId) as (WorkflowPhaseRunRow & { phase_name: string; phase_order: number })[]

  return { run, phases }
}
