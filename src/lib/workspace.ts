import { NextRequest } from 'next/server'
import { getDatabase } from './db'

export const DEFAULT_WORKSPACE_ID = 1
const WORKSPACE_COOKIE = 'mc-workspace-id'

export function parseWorkspaceId(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

export function getWorkspaceIdFromRequest(request: Request | NextRequest, fallback = DEFAULT_WORKSPACE_ID): number {
  const headerValue = request.headers.get('x-workspace-id')
  const fromHeader = parseWorkspaceId(headerValue)
  if (fromHeader) return fromHeader

  const cookieHeader = request.headers.get('cookie') || ''
  const cookieMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${WORKSPACE_COOKIE}=([^;]*)`))
  const fromCookie = parseWorkspaceId(cookieMatch ? decodeURIComponent(cookieMatch[1]) : null)
  if (fromCookie) return fromCookie

  return fallback
}

export function workspaceExists(workspaceId: number): boolean {
  const db = getDatabase()
  const row = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as { id: number } | undefined
  return !!row
}

export function normalizeWorkspaceId(request: Request | NextRequest, fallback = DEFAULT_WORKSPACE_ID): number {
  const id = getWorkspaceIdFromRequest(request, fallback)
  return workspaceExists(id) ? id : fallback
}

export function workspaceCookieName(): string {
  return WORKSPACE_COOKIE
}
