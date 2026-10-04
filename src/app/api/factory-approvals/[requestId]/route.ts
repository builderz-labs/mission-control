import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { factoryApprovalDecisionSchema } from '@/lib/factories/schemas'
import { getFactoryApproval, getFactoryInstance, recordFactoryApprovalDecision } from '@/lib/factories/store'
import { getFactoryAdapter } from '@/lib/factories/registry'
import { recordExperience } from '@/lib/factories/learning-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const parsed = factoryApprovalDecisionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid approval decision', detail: parsed.error.flatten() }, { status: 400 })
  }

  const { requestId } = await params
  try {
    const decodedRequestId = decodeURIComponent(requestId)

    if (parsed.data.decision === 'approve') {
      const current = getFactoryApproval(ws.workspaceId, decodedRequestId)
      if (!current) return NextResponse.json({ error: 'Factory approval request not found' }, { status: 404 })

      const instance = getFactoryInstance(ws.workspaceId, current.instance_id)
      const adapter = instance ? getFactoryAdapter(instance.adapter_id) : null
      const gateDefinition = adapter?.getDefinition().gates.find((gate) =>
        current.gate_id === gate.id || current.gate_id.startsWith(gate.id + ':'),
      )
      const commandId = gateDefinition?.apply_command || null
      const requestForGate = commandId ? {
        command_id: commandId,
        arguments: { gate: current.gate_id, note: parsed.data.note || '' },
        expected_revision: current.expected_revision,
        requested_by: auth.user.username,
      } : null
      const availability = commandId && instance?.latest_snapshot
        ? adapter?.canExecute?.(instance.latest_snapshot, requestForGate!)
          || instance.latest_snapshot.available_commands.find((command) => command.command_id === commandId)
        : null

      if (!commandId || availability?.available !== true) {
        return NextResponse.json({
          error: availability?.reason || 'This Factory gate has no currently available native apply path.',
        }, { status: 409 })
      }
    }

    const approval = recordFactoryApprovalDecision({
      workspaceId: ws.workspaceId,
      requestId: decodedRequestId,
      decision: parsed.data.decision,
      note: parsed.data.note,
      actor: auth.user.username,
      expectedRevision: parsed.data.expected_revision,
    })
    try {
      recordExperience({
        workspaceId: ws.workspaceId,
        experienceId: `approval-decision:${approval.request_id}`,
        factoryInstanceId: approval.instance_id,
        actionType: 'approval_decision',
        workerKind: 'human',
        workerIdentity: auth.user.username,
        inputs: [{ gate_id: approval.gate_id, decision: parsed.data.decision }],
        evidenceRefs: [`approval:${approval.request_id}`],
        sourceRevision: approval.expected_revision,
        outcome: 'success',
        cost: { paid_usd: 0 },
      })
    } catch (error) {
      console.error('Factory approval decision was recorded, but experience logging failed:', error)
    }
    return NextResponse.json({ approval })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record approval decision'
    const status = message.includes('not found') ? 404 : message.includes('revision') || message.includes('not open') || message.includes('changed before') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
