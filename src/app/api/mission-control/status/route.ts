import { NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest) {
  try {
    const gov = await import('../../../../../scripts/workflow-governor.cjs') as unknown as {
      run: (argv: string[], injectedBotResults?: Record<string, unknown>) => Record<string, unknown>
    }
    const result = gov.run([])
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({
      agent: 'Mission Control Status API',
      label: 'OBSERVE ONLY',
      status: 'FAIL',
      risk_level: 3,
      timestamp: new Date().toISOString(),
      error: { message },
    })
  }
}
