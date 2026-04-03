import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getClaudeCodeTasks } from '@/lib/claude-tasks'

/**
 * GET /api/claude-tasks — Returns Claude Code teams and tasks
 * Read-only bridge: MC reads from ~/.claude/tasks/ and ~/.claude/teams/
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const force = request.nextUrl.searchParams.get('force') === 'true'
  const result = getClaudeCodeTasks(force)

  return NextResponse.json(result)
}
