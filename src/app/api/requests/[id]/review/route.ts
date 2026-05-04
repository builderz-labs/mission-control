import { NextRequest, NextResponse } from 'next/server'
import { submitForReview } from '@/lib/request-gateway'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json()
    const { id } = await params

    if (!body?.request || body.request.id !== id) {
      throw new Error('Request id does not match route id.')
    }

    const updated = submitForReview(body.request)
    return NextResponse.json({ request: updated }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid request.' },
      { status: 400 },
    )
  }
}
