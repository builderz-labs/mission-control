import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getGatewayProxyManager } from '@/lib/gateway-proxy'

/**
 * GET /api/gateway-proxy/health
 *
 * Reports the current health of the server-side gateway proxy connection.
 * Useful for monitoring and post-deployment readiness checks.
 *
 * Returns:
 *   { enabled: false }                    — proxy mode not enabled
 *   { enabled: true, connected: boolean } — proxy mode enabled with live status
 */
export async function GET(request: NextRequest) {
  if (!config.gatewayProxyMode) {
    return NextResponse.json({ enabled: false })
  }

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const manager = getGatewayProxyManager()
  const connected = manager.isConnected()

  return NextResponse.json({
    enabled: true,
    connected,
    gateway: `${config.gatewayHost}:${config.gatewayPort}`,
    timestamp: Date.now(),
  })
}
