import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getStripeRevenueSnapshot } from '@/lib/stripe-revenue'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const snapshot = await getStripeRevenueSnapshot()
    return NextResponse.json(snapshot)
  } catch (err) {
    logger.error({ err }, 'GET /api/stripe-revenue error')
    return NextResponse.json({ error: 'Failed to fetch Stripe revenue' }, { status: 500 })
  }
}
