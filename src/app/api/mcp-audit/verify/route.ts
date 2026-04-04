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

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const recordId = searchParams.get('id')

  // Single record verification
  if (recordId) {
    const result = verifyMcpCallReceipt(parseInt(recordId, 10))
    return NextResponse.json({
      ...result,
      publicKey: getPublicKey(),
      verifiedAt: new Date().toISOString(),
    })
  }

  // Batch verification (default: last 24 hours)
  const hours = parseInt(searchParams.get('hours') ?? '24', 10)
  const workspaceId = parseInt(searchParams.get('workspace_id') ?? '1', 10)

  const result = verifyMcpCallReceipts(hours, workspaceId)
  return NextResponse.json({
    ...result,
    integrityStatus: result.failed === 0 ? 'intact' : 'compromised',
    publicKey: getPublicKey(),
    verifiedAt: new Date().toISOString(),
    period: `${hours}h`,
  })
}
