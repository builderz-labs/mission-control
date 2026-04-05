import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { generateCostForecast } from '@/lib/cost-forecast'

const DEFAULT_BUDGET_USD = 500

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const budgetParam = searchParams.get('budget')
    const budgetThreshold = budgetParam ? parseFloat(budgetParam) : DEFAULT_BUDGET_USD
    const workspaceId = auth.user.workspace_id ?? 1

    const db = getDatabase()
    const forecast = generateCostForecast(workspaceId, db, budgetThreshold)

    return NextResponse.json(forecast)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to generate forecast: ${message}` }, { status: 500 })
  }
}
