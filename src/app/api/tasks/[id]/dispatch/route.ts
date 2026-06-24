import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

/**
 * Mission Control control plane — dispatch a task to its assigned agent.
 *
 * POST  /api/tasks/[id]/dispatch  — operator clicks "Dispatch". MC forwards to
 *   Atlas's HTTP intake (config.atlas.dispatchUrl, shared-key auth). Atlas runs
 *   a Claude Code session in the agent's repo and reports back via PATCH.
 * PATCH /api/tasks/[id]/dispatch  — Atlas posts run status (in_progress / done /
 *   failed) back here (authenticated by x-api-key). Updates the task + emits an
 *   event so the board reflects it live.
 *
 * This does NOT use the OpenClaw gateway and never re-enables the GET-path
 * reconciler (the 22 Jun task-eating bug) — dispatch only happens on this
 * explicit POST.
 */

function getTask(taskId: number, workspaceId: number): any {
  return getDatabase()
    .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
    .get(taskId, workspaceId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = mutationLimiter(request);
  if (limited) return limited;

  const taskId = parseInt((await params).id);
  if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });

  if (!config.atlas.dispatchUrl || !config.atlas.dispatchKey) {
    return NextResponse.json(
      { error: 'Dispatch not configured — set ATLAS_DISPATCH_URL and ATLAS_DISPATCH_KEY' },
      { status: 503 }
    );
  }

  const workspaceId = auth.user.workspace_id ?? 1;
  const task = getTask(taskId, workspaceId);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const agent = (task.assigned_to || '').trim();
  if (!agent) {
    return NextResponse.json(
      { error: 'Task has no assigned agent — assign one before dispatching' },
      { status: 400 }
    );
  }

  // Prompt = the task as the agent should see it. Kept simple + explicit.
  const prompt = [
    `Task: ${task.title}`,
    task.description ? `\nDetails:\n${task.description}` : '',
    `\nWhen done, follow the repo's CLAUDE.md and the global deploy protocol.`,
  ].join('');

  // Where Atlas reports status back. Prefer the public base so Atlas (on the
  // host) can reach MC through nginx; fall back to the request origin.
  const mcBase = (process.env.MC_PUBLIC_URL || request.nextUrl.origin).replace(/\/$/, '');
  const callbackUrl = `${mcBase}/api/tasks/${taskId}/dispatch`;

  let atlasRes: Response;
  try {
    atlasRes = await fetch(`${config.atlas.dispatchUrl.replace(/\/$/, '')}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dispatch-Key': config.atlas.dispatchKey },
      body: JSON.stringify({
        agent: agent.toLowerCase(),
        prompt,
        mc_task_id: String(taskId),
        callback_url: callbackUrl,
        requested_by: auth.user.username || auth.user.email || 'mc',
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.error({ taskId, err: String(err) }, 'dispatch: Atlas intake unreachable');
    return NextResponse.json(
      { error: 'Atlas dispatch service unreachable', detail: String(err) },
      { status: 502 }
    );
  }

  const body = await atlasRes.json().catch(() => ({}));
  if (!atlasRes.ok) {
    logger.warn({ taskId, status: atlasRes.status, body }, 'dispatch: Atlas rejected');
    return NextResponse.json(
      { error: body.error || 'Atlas rejected the dispatch', atlasStatus: atlasRes.status },
      { status: atlasRes.status }
    );
  }

  // Optimistically reflect "in progress" on the board; Atlas's PATCH finalises.
  try {
    getDatabase()
      .prepare("UPDATE tasks SET status = 'in_progress', updated_at = unixepoch() WHERE id = ? AND workspace_id = ?")
      .run(taskId, workspaceId);
    eventBus.emit('task', { type: 'task.dispatched', taskId, agent });
  } catch (err) {
    logger.warn({ taskId, err: String(err) }, 'dispatch: optimistic status update failed');
  }

  logger.info({ taskId, agent, dispatchId: body.dispatch_id }, 'dispatch: forwarded to Atlas');
  return NextResponse.json({ ok: true, ...body });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Callback from Atlas — admin via x-api-key.
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const taskId = parseInt((await params).id);
  if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });

  const payload = await request.json().catch(() => ({} as any));
  const incoming = String(payload.status || '').toLowerCase();

  // Map Atlas run states → MC task statuses.
  const statusMap: Record<string, string> = {
    in_progress: 'in_progress',
    running: 'in_progress',
    done: 'review', // land in review for a human glance, not silently "done"
    failed: 'failed',
    rejected: 'assigned',
  };
  const newStatus = statusMap[incoming];
  if (!newStatus) return NextResponse.json({ error: `unknown status '${incoming}'` }, { status: 400 });

  const workspaceId = auth.user.workspace_id ?? 1;
  const task = getTask(taskId, workspaceId);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  try {
    const db = getDatabase();
    db.prepare('UPDATE tasks SET status = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
      .run(newStatus, taskId, workspaceId);

    // Drop the outcome / error as a comment so it's visible on the card.
    const note =
      incoming === 'done'
        ? `✅ Dispatch done${payload.cost_usd != null ? ` ($${Number(payload.cost_usd).toFixed(2)})` : ''}\n${payload.outcome || ''}`.trim()
        : incoming === 'failed'
          ? `❌ Dispatch failed: ${payload.error || 'unknown error'}`
          : incoming === 'rejected'
            ? '🔴 Dispatch rejected in Slack'
            : null;
    if (note) {
      try {
        db.prepare(
          'INSERT INTO comments (task_id, author, content, created_at, parent_id, mentions, workspace_id) ' +
            'VALUES (?, ?, ?, unixepoch(), NULL, NULL, ?)'
        ).run(taskId, 'atlas', note, workspaceId);
      } catch {
        /* non-fatal — the status update is what matters */
      }
    }
    eventBus.emit('task', { type: 'task.dispatch_update', taskId, status: newStatus });
  } catch (err) {
    logger.error({ taskId, err: String(err) }, 'dispatch callback: update failed');
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
