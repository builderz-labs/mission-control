import { NextRequest, NextResponse } from 'next/server'
import { createRequest } from '@/lib/request-gateway'

export async function POST(request: NextRequest) {
  try {
    const input = await request.json()
    const created = createRequest(input)
    return NextResponse.json({ request: created }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid request.' },
      { status: 400 },
    )
  }
}
