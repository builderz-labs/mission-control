'use client'

import { useCallback, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { extractApiErrorMessage } from '@/lib/api-error-message'
import { useMissionControl, type ChatAttachment, type ChatMessage, type Conversation } from '@/store'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('useDesktopSend')

export function useDesktopSend(onSessionRefresh: () => void) {
  const {
    activeConversation,
    addChatMessage,
    replacePendingMessage,
    updatePendingMessage,
  } = useMissionControl()
  const pendingIdRef = useRef(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendAgent = useCallback(async (content: string, conversationId: string, attachments?: ChatAttachment[]) => {
    const mentionMatch = content.match(/^@(\w+)\s/)
    const to = mentionMatch ? mentionMatch[1] : conversationId.replace('agent_', '')
    const clean = mentionMatch ? content.slice(mentionMatch[0].length) : content
    pendingIdRef.current -= 1
    const tempId = pendingIdRef.current
    addChatMessage({
      id: tempId,
      conversation_id: conversationId,
      from_agent: 'human',
      to_agent: to,
      content: clean,
      message_type: 'text',
      attachments,
      created_at: Math.floor(Date.now() / 1000),
      pendingStatus: 'sending',
    })
    setBusy(true)
    try {
      const data = await apiFetch<{ message?: ChatMessage }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          from: 'human',
          to,
          content: clean,
          conversation_id: conversationId,
          message_type: 'text',
          attachments,
          forward: true,
        }),
      })
      if (data.message) replacePendingMessage(tempId, data.message)
    } catch (err) {
      log.error('Failed to send message:', err)
      updatePendingMessage(tempId, { pendingStatus: 'failed' })
    } finally {
      setBusy(false)
    }
  }, [addChatMessage, replacePendingMessage, updatePendingMessage])

  const sendSession = useCallback(async (
    prompt: string,
    session: NonNullable<Conversation['session']>,
    options?: { model?: string; fast?: boolean; effort?: string; permissionMode?: string },
  ) => {
    setBusy(true)
    setError(null)
    try {
      if (session.sessionKind === 'gateway') {
        const agentName = session.agent || session.sessionId.split(':')[1] || 'unknown'
        await apiFetch('/api/chat/messages', {
          method: 'POST',
          body: JSON.stringify({
            from: 'human',
            to: agentName,
            content: prompt,
            conversation_id: `agent_${agentName}`,
            message_type: 'text',
            forward: true,
            sessionKey: session.sessionKey || undefined,
          }),
        })
        setTimeout(() => onSessionRefresh(), 2000)
      } else {
        await apiFetch('/api/sessions/continue', {
          method: 'POST',
          body: JSON.stringify({
            kind: session.sessionKind,
            id: session.sessionId,
            prompt,
            model: options?.model,
            fast: options?.fast,
            effort: options?.effort,
            permissionMode: options?.permissionMode,
          }),
        })
        onSessionRefresh()
      }
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Failed to continue session'))
    } finally {
      setBusy(false)
    }
  }, [onSessionRefresh])

  return { busy, error, sendAgent, sendSession, activeConversation }
}
