import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { getFactoryInstance, listFactoryApprovals } from '@/lib/factories/store'
import { getFactoryAdapter } from '@/lib/factories/registry'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const stateParam = new URL(request.url).searchParams.get('state')
  const states = stateParam ? stateParam.split(',').map((v) => v.trim()).filter(Boolean) : undefined
  const approvals = listFactoryApprovals(ws.workspaceId, states).map((approval) => {
    const instance = getFactoryInstance(ws.workspaceId, approval.instance_id)
    const adapter = instance ? getFactoryAdapter(instance.adapter_id) : null
    const gateDefinition = adapter?.getDefinition().gates.find((gate) =>
      approval.gate_id === gate.id || approval.gate_id.startsWith(gate.id + ':'),
    )
    const commandId = gateDefinition?.apply_command || null
    const request = commandId ? {
      command_id: commandId,
      arguments: { gate: approval.gate_id, note: approval.decision_note || '' },
      expected_revision: approval.expected_revision,
      requested_by: approval.decision_by || 'local-owner',
    } : null
    const command = commandId && instance?.latest_snapshot
      ? adapter?.canExecute?.(instance.latest_snapshot, request!)
        || instance.latest_snapshot.available_commands.find((item) => item.command_id === commandId)
      : null
    return {
      ...approval,
      native_stage: instance?.latest_snapshot?.lifecycle.native_stage || null,
      freshness: instance?.latest_snapshot?.freshness.state || null,
      can_apply: command?.available === true,
      block_reason: command?.available === false ? command.reason || 'Native approval is not currently available.' : null,
    }
  })
  return NextResponse.json({ approvals })
}
