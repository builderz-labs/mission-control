import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { eventBus } from '@/lib/event-bus'

interface PipelineStep {
  template_id: number
  on_failure: 'stop' | 'continue'
}

interface RunStepState {
  step_index: number
  template_id: number
  template_name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  spawn_id: string | null
  started_at: number | null
  completed_at: number | null
  error: string | null
}

interface PipelineRun {
  id: number
  pipeline_id: number
  status: string
  current_step: number
  steps_snapshot: string
  started_at: number | null
  completed_at: number | null
  triggered_by: string
  created_at: number
}

/**
 * GET /api/pipelines/run - Get pipeline runs
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const pipelineId = searchParams.get('pipeline_id')
    const runId = searchParams.get('id')
    const limit = parseInt(searchParams.get('limit') || '20')

    if (runId) {
      const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(parseInt(runId)) as PipelineRun | undefined
      if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      return NextResponse.json({ run: { ...run, steps_snapshot: JSON.parse(run.steps_snapshot) } })
    }

    let query = 'SELECT * FROM pipeline_runs'
    const params: any[] = []

    if (pipelineId) {
      query += ' WHERE pipeline_id = ?'
      params.push(parseInt(pipelineId))
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const runs = db.prepare(query).all(...params) as PipelineRun[]

    // Enrich with pipeline names
    const pipelineIds = [...new Set(runs.map(r => r.pipeline_id))]
    const pipelines = pipelineIds.length > 0
      ? db.prepare(`SELECT id, name FROM workflow_pipelines WHERE id IN (${pipelineIds.map(() => '?').join(',')})`).all(...pipelineIds) as Array<{ id: number; name: string }>
      : []
    const nameMap = new Map(pipelines.map(p => [p.id, p.name]))

    const parsed = runs.map(r => ({
      ...r,
      pipeline_name: nameMap.get(r.pipeline_id) || 'Deleted Pipeline',
      steps_snapshot: JSON.parse(r.steps_snapshot),
    }))

    return NextResponse.json({ runs: parsed })
  } catch (error) {
    console.error('GET /api/pipelines/run error:', error)
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
  }
}

/**
 * POST /api/pipelines/run - Start a pipeline run or advance a running one
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const { action, pipeline_id, run_id } = body

    if (action === 'start') {
      return startPipeline(db, pipeline_id, auth.user?.username || 'system')
    } else if (action === 'advance') {
      return advanceRun(db, run_id, body.success ?? true, body.error)
    } else if (action === 'cancel') {
      return cancelRun(db, run_id)
    }

    return NextResponse.json({ error: 'Invalid action. Use: start, advance, cancel' }, { status: 400 })
  } catch (error) {
    console.error('POST /api/pipelines/run error:', error)
    return NextResponse.json({ error: 'Failed to process pipeline run' }, { status: 500 })
  }
}

/** Spawn a single pipeline step using `openclaw agent` */
async function spawnStep(
  db: ReturnType<typeof getDatabase>,
  pipelineName: string,
  template: { name: string; model: string; task_prompt: string; timeout_seconds: number },
  steps: RunStepState[],
  stepIdx: number,
  runId: number
): Promise<{ success: boolean; stdout?: string; error?: string }> {
  try {
    const { runOpenClaw } = await import('@/lib/command')
    const args = [
      'agent',
      '--message', `[Pipeline: ${pipelineName} | Step ${stepIdx + 1}] ${template.task_prompt}`,
      '--timeout', String(template.timeout_seconds),
      '--json',
    ]
    const { stdout } = await runOpenClaw(args, { timeoutMs: 15000 })

    const spawnId = `pipeline-${runId}-step-${stepIdx}-${Date.now()}`
    steps[stepIdx].spawn_id = spawnId
    db.prepare('UPDATE pipeline_runs SET steps_snapshot = ? WHERE id = ?').run(JSON.stringify(steps), runId)

    return { success: true, stdout: stdout.trim() }
  } catch (err: any) {
    // Spawn failed - record error but keep pipeline running for manual advance
    steps[stepIdx].error = err.message
    db.prepare('UPDATE pipeline_runs SET steps_snapshot = ? WHERE id = ?').run(JSON.stringify(steps), runId)

    return { success: false, error: err.message }
  }
}

async function startPipeline(db: ReturnType<typeof getDatabase>, pipelineId: number, triggeredBy: string) {
  const pipeline = db.prepare('SELECT * FROM workflow_pipelines WHERE id = ?').get(pipelineId) as any
  if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

  const steps: PipelineStep[] = JSON.parse(pipeline.steps || '[]')
  if (steps.length === 0) return NextResponse.json({ error: 'Pipeline has no steps' }, { status: 400 })

  // Get template names for snapshot
  const templateIds = steps.map(s => s.template_id)
  const templates = db.prepare(
    `SELECT id, name, model, task_prompt, timeout_seconds FROM workflow_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`
  ).all(...templateIds) as Array<{ id: number; name: string; model: string; task_prompt: string; timeout_seconds: number }>
  const templateMap = new Map(templates.map(t => [t.id, t]))

  // Build step snapshot
  const stepsSnapshot: RunStepState[] = steps.map((s, i) => ({
    step_index: i,
    template_id: s.template_id,
    template_name: templateMap.get(s.template_id)?.name || 'Unknown',
    on_failure: s.on_failure,
    status: i === 0 ? 'running' : 'pending',
    spawn_id: null,
    started_at: i === 0 ? Math.floor(Date.now() / 1000) : null,
    completed_at: null,
    error: null,
  }))

  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    INSERT INTO pipeline_runs (pipeline_id, status, current_step, steps_snapshot, started_at, triggered_by)
    VALUES (?, 'running', 0, ?, ?, ?)
  `).run(pipelineId, JSON.stringify(stepsSnapshot), now, triggeredBy)

  const runId = Number(result.lastInsertRowid)

  // Update pipeline usage
  db.prepare(`
    UPDATE workflow_pipelines SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, pipelineId)

  // Spawn first step
  const firstTemplate = templateMap.get(steps[0].template_id)
  let spawnResult: any = null
  if (firstTemplate) {
    spawnResult = await spawnStep(db, pipeline.name, firstTemplate, stepsSnapshot, 0, runId)
  }

  db_helpers.logActivity('pipeline_started', 'pipeline', pipelineId, triggeredBy, `Started pipeline: ${pipeline.name}`, { run_id: runId })

  eventBus.broadcast('activity.created', {
    type: 'pipeline_started',
    entity_type: 'pipeline',
    entity_id: pipelineId,
    description: `Pipeline "${pipeline.name}" started`,
    data: { run_id: runId },
  })

  return NextResponse.json({
    run: {
      id: runId,
      pipeline_id: pipelineId,
      status: stepsSnapshot[0].status === 'failed' ? 'failed' : 'running',
      current_step: 0,
      steps_snapshot: stepsSnapshot,
      spawn: spawnResult,
    }
  }, { status: 201 })
}

async function advanceRun(db: ReturnType<typeof getDatabase>, runId: number, success: boolean, errorMsg?: string) {
  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 })

  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as PipelineRun | undefined
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'running') return NextResponse.json({ error: `Run is ${run.status}, not running` }, { status: 400 })

  const steps: (RunStepState & { on_failure?: string })[] = JSON.parse(run.steps_snapshot)
  const currentIdx = run.current_step
  const now = Math.floor(Date.now() / 1000)

  // Mark current step as completed/failed
  steps[currentIdx].status = success ? 'completed' : 'failed'
  steps[currentIdx].completed_at = now
  if (errorMsg) steps[currentIdx].error = errorMsg

  // Determine next action
  const nextIdx = currentIdx + 1
  const onFailure = steps[currentIdx].on_failure || 'stop'

  if (!success && onFailure === 'stop') {
    // Mark remaining steps as skipped
    for (let i = nextIdx; i < steps.length; i++) steps[i].status = 'skipped'
    db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ?')
      .run('failed', currentIdx, JSON.stringify(steps), now, runId)
    return NextResponse.json({ run: { id: runId, status: 'failed', steps_snapshot: steps } })
  }

  if (nextIdx >= steps.length) {
    // Pipeline complete
    const finalStatus = steps.some(s => s.status === 'failed') ? 'completed' : 'completed'
    db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ?')
      .run(finalStatus, currentIdx, JSON.stringify(steps), now, runId)

    eventBus.broadcast('activity.created', {
      type: 'pipeline_completed',
      entity_type: 'pipeline',
      entity_id: run.pipeline_id,
      description: `Pipeline run #${runId} completed`,
    })

    return NextResponse.json({ run: { id: runId, status: finalStatus, steps_snapshot: steps } })
  }

  // Spawn next step
  steps[nextIdx].status = 'running'
  steps[nextIdx].started_at = now

  const template = db.prepare('SELECT id, name, model, task_prompt, timeout_seconds FROM workflow_templates WHERE id = ?')
    .get(steps[nextIdx].template_id) as any

  let spawnResult: any = null
  if (template) {
    const pipeline = db.prepare('SELECT name FROM workflow_pipelines WHERE id = ?').get(run.pipeline_id) as any
    spawnResult = await spawnStep(db, pipeline?.name || '?', template, steps, nextIdx, runId)
  }

  db.prepare('UPDATE pipeline_runs SET current_step = ?, steps_snapshot = ? WHERE id = ?')
    .run(nextIdx, JSON.stringify(steps), runId)

  return NextResponse.json({
    run: { id: runId, status: 'running', current_step: nextIdx, steps_snapshot: steps, spawn: spawnResult }
  })
}

function cancelRun(db: ReturnType<typeof getDatabase>, runId: number) {
  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 })

  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as PipelineRun | undefined
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'running' && run.status !== 'pending') {
    return NextResponse.json({ error: `Run is ${run.status}, cannot cancel` }, { status: 400 })
  }

  const steps: RunStepState[] = JSON.parse(run.steps_snapshot)
  const now = Math.floor(Date.now() / 1000)

  for (const step of steps) {
    if (step.status === 'pending' || step.status === 'running') {
      step.status = 'skipped'
      step.completed_at = now
    }
  }

  db.prepare('UPDATE pipeline_runs SET status = ?, steps_snapshot = ?, completed_at = ? WHERE id = ?')
    .run('cancelled', JSON.stringify(steps), now, runId)

  return NextResponse.json({ run: { id: runId, status: 'cancelled', steps_snapshot: steps } })
}
