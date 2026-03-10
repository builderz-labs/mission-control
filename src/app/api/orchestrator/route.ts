import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { requireRole, getUserFromRequest } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { spawnOrchestrator, listFiles, resolveIniniTask, suggestProjectFiles } from '@/lib/orchestrator-spawn'
import { applyOrchestratorAction, updateOrchestratorFeatureToggles } from '@/lib/orchestrator-control'
import { ensureSchedulerStarted, ensureWebhookListenerStarted } from '@/lib/runtime-services'

function getProjectHealth(folder: string) {
  const folderExists = existsSync(folder)
  const entryExists = folderExists && existsSync(join(folder, 'index.js'))
  return {
    folder_exists: folderExists,
    runnable: folderExists && entryExists,
    issue: !folderExists
      ? 'Folder does not exist'
      : !entryExists
      ? 'No index.js found in folder — not an orchestrator project'
      : null,
  }
}

/** GET /api/orchestrator — list projects + recent runs */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  ensureWebhookListenerStarted()

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('runId')
    const projectIdParam = searchParams.get('project_id')
    const taskPreview = searchParams.get('task') || undefined

    // Single run detail (for polling) — include pipeline fields
    if (runId) {
      const run = db.prepare('SELECT * FROM orchestrator_runs WHERE id = ?').get(runId) as any
      if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      return NextResponse.json({ run: { ...run, files: JSON.parse(run.files_json || '[]') } })
    }

    // Suggest files for a given project (used by panel file-picker)
    if (projectIdParam) {
      const project = db.prepare('SELECT id, name, folder, description, created_at, updated_at FROM orchestrator_projects WHERE id = ?').get(projectIdParam) as any
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      const health = getProjectHealth(project.folder)
      if (!health.runnable) {
        return NextResponse.json({
          error: health.issue,
          project: { ...project, ...health },
          suggestedFiles: [],
        }, { status: 409 })
      }
      const suggestedFiles = suggestProjectFiles(project.folder, taskPreview)
      return NextResponse.json({ suggestedFiles, project: { ...project, ...health } })
    }

    const projects = (db.prepare('SELECT * FROM orchestrator_projects ORDER BY created_at DESC').all() as any[])
      .map((project) => ({ ...project, ...getProjectHealth(project.folder) }))
    const runs = db.prepare(
      `SELECT id, project_id, folder, task_description, status, exit_code, grade,
              started_at, completed_at, task_id
       FROM orchestrator_runs ORDER BY started_at DESC LIMIT 50`
    ).all()

    return NextResponse.json({ projects, runs })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/orchestrator error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Returns true if folder is safe to use as an orchestrator project path. */
function isSafeFolder(folder: string): boolean {
  const normalized = resolve(folder).replace(/\\/g, '/').toLowerCase()
  const BLOCKED_PREFIXES = [
    '/etc', '/root', '/proc', '/sys', '/boot', '/dev', '/run',
    'c:/windows', 'c:/system32', 'c:/program files', 'c:/programdata',
    '/usr/bin', '/usr/sbin', '/bin', '/sbin',
  ]
  return !BLOCKED_PREFIXES.some(p => normalized.startsWith(p))
}

/** POST /api/orchestrator — register project or start a run */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  ensureWebhookListenerStarted()
  ensureSchedulerStarted()

  try {
    const db = getDatabase()
    const body = await request.json()
    const user = getUserFromRequest(request)
    const actor = user?.username || 'system'

    if (['wake', 'start', 'pause', 'stop', 'restart'].includes(body.action)) {
      const result = await applyOrchestratorAction(body.action, actor)
      return NextResponse.json(result)
    }

    if (body.action === 'set_features') {
      const result = updateOrchestratorFeatureToggles({
        autonomousLoopEnabled: body.autonomousLoopEnabled,
        autoSpawnEnabled: body.autoSpawnEnabled,
        debateEnabled: body.debateEnabled,
        selfHealEnabled: body.selfHealEnabled,
      }, actor)
      const status = result.ok ? 200 : 400
      return NextResponse.json(result, { status })
    }

    // Register/update project
    if (body.action === 'register_project') {
      const { id, name, folder, description } = body
      if (!name?.trim() || !folder?.trim()) return NextResponse.json({ error: 'name and folder required' }, { status: 400 })
      if (!isSafeFolder(folder)) return NextResponse.json({ error: 'Folder path not allowed' }, { status: 403 })
      if (!existsSync(folder)) return NextResponse.json({ error: 'Folder does not exist' }, { status: 404 })

      const now = Math.floor(Date.now() / 1000)
      if (id) {
        const existingById = db.prepare('SELECT id FROM orchestrator_projects WHERE id = ?').get(id) as any
        if (!existingById) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        const duplicateFolder = db.prepare('SELECT id FROM orchestrator_projects WHERE folder = ? AND id != ?').get(folder, id) as any
        if (duplicateFolder) return NextResponse.json({ error: 'Another project already uses this folder' }, { status: 409 })
        db.prepare('UPDATE orchestrator_projects SET name = ?, folder = ?, description = ?, updated_at = ? WHERE id = ?')
          .run(name.trim(), folder.trim(), description?.trim() || null, now, id)
        return NextResponse.json({ project: { id, name, folder, description, ...getProjectHealth(folder) } })
      }
      const existing = db.prepare('SELECT id FROM orchestrator_projects WHERE folder = ?').get(folder) as any
      if (existing) {
        db.prepare('UPDATE orchestrator_projects SET name = ?, description = ?, updated_at = ? WHERE id = ?')
          .run(name.trim(), description?.trim() || null, now, existing.id)
        return NextResponse.json({ project: { id: existing.id, name, folder, description, ...getProjectHealth(folder) } })
      }
      const res = db.prepare('INSERT INTO orchestrator_projects (name, folder, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(name.trim(), folder.trim(), description?.trim() || null, now, now)
      return NextResponse.json({ project: { id: res.lastInsertRowid, name, folder, description, ...getProjectHealth(folder) } }, { status: 201 })
    }

    // Start an orchestrator run
    if (body.action === 'run' || body.folder) {
      const { folder, task, project_id, task_id } = body
      if (!folder?.trim()) return NextResponse.json({ error: 'folder required' }, { status: 400 })
      if (!task?.trim()) return NextResponse.json({ error: 'task description required' }, { status: 400 })
      if (!isSafeFolder(folder)) return NextResponse.json({ error: 'Folder path not allowed' }, { status: 403 })
      if (!existsSync(folder)) return NextResponse.json({ error: 'Folder does not exist' }, { status: 404 })
      if (!existsSync(join(folder, 'index.js'))) return NextResponse.json({ error: 'No index.js found in folder — not an orchestrator project' }, { status: 400 })

      const now = Math.floor(Date.now() / 1000)

      // Pre-run bugfix check: if last run for this project failed, prepend error context
      let finalTask = task.trim()
      if (project_id) {
        const lastFailed = db.prepare(
          `SELECT output, error, task_description FROM orchestrator_runs
           WHERE project_id = ? AND status = 'failed'
           ORDER BY started_at DESC LIMIT 1`
        ).get(project_id) as any
        if (lastFailed) {
          const errSnippet = (lastFailed.error || lastFailed.output?.slice(-400) || '').replace(/\x1B\[[0-9;]*m/g, '').slice(0, 250)
          if (errSnippet) {
            finalTask = `⚠️ BUGFIX REQUIRED — previous run failed:\n"${errSnippet}"\n\nNEW TASK: ${finalTask}`
          }
        }
      }

      const runRow = db.prepare(
        `INSERT INTO orchestrator_runs (project_id, folder, task_description, status, started_at, task_id)
         VALUES (?, ?, ?, 'running', ?, ?)`
      ).run(project_id || null, folder.trim(), finalTask, now, task_id || null)
      const runId = runRow.lastInsertRowid as number

      logAuditEvent({ action: 'orchestrator_run_start', actor, detail: { run_id: runId, folder, task: finalTask } })

      spawnOrchestrator(runId, folder, finalTask)

      return NextResponse.json({ run_id: runId }, { status: 202 })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/orchestrator error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE /api/orchestrator?projectId= — remove a registered project */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  try {
    const db = getDatabase()
    db.prepare('DELETE FROM orchestrator_projects WHERE id = ?').run(projectId)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    logger.error({ err }, 'DELETE /api/orchestrator error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
