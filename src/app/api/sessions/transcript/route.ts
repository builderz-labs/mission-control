import { NextRequest } from 'next/server'
import { GET as getTranscript } from '@/lib/session-transcript-route'

export async function GET(request: NextRequest) {
  return getTranscript(request)
}

export const dynamic = 'force-dynamic'
