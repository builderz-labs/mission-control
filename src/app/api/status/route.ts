import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getDashboardData, getSystemStatus } from './status-helpers'
import { getGatewayStatus, getAvailableModels } from './gateway-helpers'
import { performHealthCheck, getCapabilities } from './health-helpers'

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Docker/Kubernetes health probes must work without auth/cookies.
  const preAction = new URL(request.url).searchParams.get('action') || 'overview'
  if (preAction === 'health') {
    const health = await performHealthCheck()
    return NextResponse.json(health)
  }

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'overview'

    if (action === 'overview') {
      const status = await getSystemStatus(auth.user.workspace_id ?? 1)
      return NextResponse.json(status)
    }

    if (action === 'dashboard') {
      const data = await getDashboardData(auth.user.workspace_id ?? 1)
      return NextResponse.json(data)
    }

    if (action === 'gateway') {
      const gatewayStatus = await getGatewayStatus()
      return NextResponse.json(gatewayStatus)
    }

    if (action === 'models') {
      const models = await getAvailableModels()
      return NextResponse.json({ models })
    }

    if (action === 'health') {
      const health = await performHealthCheck()
      return NextResponse.json(health)
    }

    if (action === 'capabilities') {
      const capabilities = await getCapabilities(request)
      return NextResponse.json(capabilities)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Status API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
