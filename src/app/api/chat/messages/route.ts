import { NextRequest, NextResponse } from 'next/server'
import { handleGetMessages } from './get-handler'
import { handlePostMessage } from './post-handler'

/**
 * Thin router — delegates to dedicated handlers so each file stays focused.
 * GET  → get-handler.ts  (list/filter messages)
 * POST → post-handler.ts (create + optional gateway forward)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGetMessages(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePostMessage(request)
}
