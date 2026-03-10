'use client'

import { useMissionControl, type ChatMessage } from '@/store'

const ORCHESTRATOR_CONVERSATION_ID = 'coord:orchestrator'

type RuntimeResponse = {
  runtime?: {
    available?: boolean
    active?: boolean
    agentName?: string | null
    reason?: string
  }
  error?: string
  agent_name?: string
}

type GatewayStatusResponse = {
  running?: boolean
  port?: number
  port_listening?: boolean
}

function makeLocalStatusMessage(content: string, metadata?: Record<string, unknown>): ChatMessage {
  const now = Math.floor(Date.now() / 1000)
  const tempId = -Math.floor(Date.now() + Math.random() * 1000)
  return {
    id: tempId,
    conversation_id: ORCHESTRATOR_CONVERSATION_ID,
    from_agent: 'orchestrator',
    to_agent: 'human',
    content,
    message_type: 'status',
    metadata,
    created_at: now,
    pendingStatus: 'sent',
  }
}

function pushStatus(content: string, metadata?: Record<string, unknown>) {
  useMissionControl.getState().addChatMessage(makeLocalStatusMessage(content, metadata))
}

export async function openOrchestratorChat() {
  const store = useMissionControl.getState()

  store.setChatPanelOpen(true)
  store.setActiveConversation(ORCHESTRATOR_CONVERSATION_ID)
  store.setRuntimeSignal({
    id: 'orchestrator-chat-bootstrap',
    message: 'Checking coordinator session',
    detail: 'preparing orchestrator chat',
    tone: 'info',
    priority: 100,
  })

  try {
    const runtimeRes = await fetch('/api/connect')
    const runtimeData = await runtimeRes.json().catch(() => ({} as RuntimeResponse))

    if (!runtimeRes.ok) {
      pushStatus('Waiting. I could not check the coordinator session yet.', {
        status: 'runtime_check_failed',
      })
      return { ok: false, reason: runtimeData.error || 'runtime_check_failed' }
    }

    if (runtimeData.runtime?.active) {
      try {
        const gatewayRes = await fetch('/api/status?action=gateway')
        const gateway = await gatewayRes.json().catch(() => ({} as GatewayStatusResponse))
        if (gatewayRes.ok && gateway.port_listening === false) {
          pushStatus(`Waiting. Coordinator is selected, but the gateway is offline on port ${gateway.port || 18789}. Start or restore the OpenClaw gateway before sending.`, {
            status: 'gateway_offline',
          })
        }
      } catch {
        // ignore bootstrap gateway probe failures
      }
      return {
        ok: true,
        activated: false,
        agentName: runtimeData.runtime.agentName || null,
      }
    }

    pushStatus('Waiting. Coordinator is offline. Waking it up now...', {
      status: 'waking_coordinator',
      reason: runtimeData.runtime?.reason || null,
    })

    store.setRuntimeSignal({
      id: 'orchestrator-chat-bootstrap',
      message: 'Waking coordinator',
      detail: 'activating local runtime',
      tone: 'warn',
      priority: 100,
    })

    const wakeRes = await fetch('/api/connect?action=activate-runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: runtimeData.runtime?.agentName || null,
      }),
    })

    const wakeData = await wakeRes.json().catch(() => ({} as RuntimeResponse))

    if (!wakeRes.ok) {
      pushStatus(
        `Waiting. I could not wake the coordinator yet: ${wakeData.error || wakeData.runtime?.reason || 'unknown error'}`,
        { status: 'wake_failed' }
      )
      return { ok: false, reason: wakeData.error || 'wake_failed' }
    }

    let gatewayOffline = false
    let gatewayPort = 18789
    try {
      const gatewayRes = await fetch('/api/status?action=gateway')
      const gateway = await gatewayRes.json().catch(() => ({} as GatewayStatusResponse))
      gatewayOffline = gatewayRes.ok && gateway.port_listening === false
      gatewayPort = gateway.port || gatewayPort
    } catch {
      // ignore bootstrap gateway probe failures
    }

    pushStatus(
      gatewayOffline
        ? `Coordinator wake requested via ${wakeData.agent_name || wakeData.runtime?.agentName || 'orchestrator'}, but the gateway is still offline on port ${gatewayPort}. Start or restore it before sending.`
        : `Coordinator wake requested via ${wakeData.agent_name || wakeData.runtime?.agentName || 'orchestrator'}. Send your message now.`,
      {
        status: gatewayOffline ? 'wake_requested_gateway_offline' : 'wake_requested',
      }
    )

    return {
      ok: true,
      activated: true,
      agentName: wakeData.agent_name || wakeData.runtime?.agentName || null,
      verifiedDelivery: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'network_error'
    pushStatus(`Waiting. I could not reach the coordinator controls: ${message}`, {
      status: 'network_error',
    })
    return { ok: false, reason: message }
  } finally {
    store.clearRuntimeSignal('orchestrator-chat-bootstrap')
  }
}
