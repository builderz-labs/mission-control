import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createApprovalItem } from '@/lib/jk/approval-queue'
import type { GateType } from '@/lib/jk/approval-queue'

const VALID_GATE_TYPES: GateType[] = [
  'monthly_strategy', 'cep_selection', 'content_brief',
  'content_execution', 'seo_plan', 'ads_plan', 'milestone_approval',
]

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Record<string, any>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { brand_id, gate_number, gate_type, month_year, summary_text } = body
  if (!brand_id || !gate_number || !gate_type || !month_year || !summary_text) {
    return NextResponse.json({ error: 'brand_id, gate_number, gate_type, month_year, summary_text are required' }, { status: 400 })
  }
  if (!VALID_GATE_TYPES.includes(gate_type)) {
    return NextResponse.json({ error: 'Invalid gate_type' }, { status: 400 })
  }

  try {
    const id = createApprovalItem({
      brand_id: parseInt(brand_id, 10),
      project_id: body.project_id ? parseInt(body.project_id, 10) : undefined,
      gate_number: parseInt(gate_number, 10),
      gate_type,
      service_type: body.service_type ?? 'brand',
      month_year,
      agent_id: body.agent_id ?? auth.user.username,
      summary_text,
      full_output: body.full_output,
      supporting_data: body.supporting_data,
    })
    return NextResponse.json({ id }, { status: 201 })
  } catch (err: any) {
    const status = err.message?.includes('Gate') ? 409 : 500
    return NextResponse.json({ error: err.message }, { status })
  }
}
