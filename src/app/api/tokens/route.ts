import { NextRequest, NextResponse } from 'next/server'
import { handleGetTokens } from './get-handler'
import { handlePostTokens } from './post-handler'

/**
 * Thin router — delegates to dedicated handlers so each file stays focused.
 * GET  → get-handler.ts  (list, stats, agent-costs, task-costs, export, trends)
 * POST → post-handler.ts (record new token usage)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGetTokens(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePostTokens(request)
}
