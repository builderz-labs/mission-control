import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getDatabase()
    db.prepare('SELECT 1 as ok').get()

    const response = NextResponse.json({
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        api: 'up',
        database: 'up',
      },
    })

    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    logger.error({ err: error }, 'Health check failed')

    const response = NextResponse.json({
      ok: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        api: 'up',
        database: 'down',
      },
    }, { status: 503 })

    response.headers.set('Cache-Control', 'no-store')
    return response
  }
}
