import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * DELETE /api/exec-replay/bookmarks/[id]
 * Delete a bookmark by id (operator only). Scoped to the caller's workspace.
 */
export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const limit = mutationLimiter(request)
  if (limit) return limit

  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const { id } = await context.params
  const bookmarkId = parseInt(id, 10)

  if (Number.isNaN(bookmarkId)) {
    return NextResponse.json({ error: 'Invalid bookmark id' }, { status: 400 })
  }

  const db = getDatabase()

  // Verify the bookmark belongs to this workspace before deleting
  const existing = db.prepare(
    'SELECT id FROM replay_bookmarks WHERE id = ? AND workspace_id = ?'
  ).get(bookmarkId, workspaceId)

  if (!existing) {
    return NextResponse.json({ error: 'Bookmark not found' }, { status: 404 })
  }

  db.prepare('DELETE FROM replay_bookmarks WHERE id = ? AND workspace_id = ?')
    .run(bookmarkId, workspaceId)

  return NextResponse.json({ success: true })
}
