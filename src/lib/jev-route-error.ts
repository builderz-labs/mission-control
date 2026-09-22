import { NextResponse } from 'next/server'
import { JevClientError } from '@/lib/jev-client'
import { JevRecordError } from '@/lib/jev-repository'
import { logger } from '@/lib/logger'

export function jevErrorResponse(error: unknown, operation: string): NextResponse {
  if (error instanceof JevClientError) {
    return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
  }
  if (error instanceof JevRecordError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  logger.error({ err: error, operation }, 'Jev request failed')
  return NextResponse.json({ error: 'Jev request failed', code: 'JEV_INTERNAL_ERROR' }, { status: 500 })
}
