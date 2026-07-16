/**
 * GET /api/mcp-audit/verify?id=<record_id>
 * GET /api/mcp-audit/verify?hours=24&workspace_id=1
 *
 * Verify the cryptographic integrity of MCP audit records.
 * Single-record verification by ID, or batch verification by time range.
 */

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { verifyMcpCallReceipt, verifyMcpCallReceipts } from '@/lib/mcp-audit'
import { getPublicKey } from '@/lib/receipt-signing'

const DEFAULT_VERIFY_HOURS = 24
const MAX_VERIFY_HOURS = 24 * 7

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const recordIdParam = searchParams.get('id')
  const workspaceId = auth.user.workspace_id ?? 1

  // Single record verification
  if (recordIdParam !== null) {
    const recordId = parsePositiveInteger(recordIdParam)
    if (recordId === null) {
      return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 })
    }

    const result = verifyMcpCallReceipt(recordId, workspaceId)
    return NextResponse.json({
      ...result,
      publicKey: getPublicKey(),
      verifiedAt: new Date().toISOString(),
    })
  }

  // Batch verification (default: last 24 hours)
  const hoursParam = searchParams.get('hours')
  const hours = hoursParam === null ? DEFAULT_VERIFY_HOURS : parsePositiveInteger(hoursParam)
  if (hours === null || hours > MAX_VERIFY_HOURS) {
    return NextResponse.json({
      error: `hours must be a positive integer no greater than ${MAX_VERIFY_HOURS}`,
    }, { status: 400 })
  }

  const result = verifyMcpCallReceipts(hours, workspaceId)
  return NextResponse.json({
    ...result,
    integrityStatus: result.failed === 0 ? 'intact' : 'compromised',
    publicKey: getPublicKey(),
    verifiedAt: new Date().toISOString(),
    period: `${hours}h`,
  })
}
