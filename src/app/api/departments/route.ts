import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { costAwareExecutionPolicy, departmentRegistry } from '@/lib/departments/registry'
import { externalCapabilityCandidates } from '@/lib/departments/external-capabilities'
import { departmentMemoryPolicy } from '@/lib/departments/memory-policy'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({
    departments: departmentRegistry,
    execution_policy: costAwareExecutionPolicy,
    capability_candidates: externalCapabilityCandidates,
    memory_policy: departmentMemoryPolicy,
  })
}
