'use client'

import { useMemo, useState } from 'react'
import { useMissionControl } from '@/store'

type TaskLike = {
  id: number
  title: string
  metadata?: any
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

export function TaskWorkstream({ task }: { task: TaskLike }) {
  const { chatMessages, logs } = useMissionControl() as any
  const [message, setMessage] = useState('')
  const [sendStatus, setSendStatus] = useState<string | null>(null)

  const taskId = task.title // for OpenClaw-projected tasks, title == taskId
  const coordConversationId = `coord:${taskId}`

  const linkedSessionKeys: string[] = useMemo(() => {
    const sess = task?.metadata?.openclaw?.sessions
    if (Array.isArray(sess)) {
      return uniq(sess.map((s: any) => s.key).filter(Boolean))
    }
    return []
  }, [task])

  const visibleConversationIds = useMemo(() => {
    return uniq([coordConversationId, ...linkedSessionKeys])
  }, [coordConversationId, linkedSessionKeys])

  const messages = useMemo(() => {
    const all = Array.isArray(chatMessages) ? chatMessages : []
    return all
      .filter((m: any) => visibleConversationIds.includes(m.conversation_id))
      .sort((a: any, b: any) => (a.created_at ?? 0) - (b.created_at ?? 0))
      .slice(-300)
  }, [chatMessages, visibleConversationIds])

  const sessionLogs = useMemo(() => {
    const all = Array.isArray(logs) ? logs : []
    const keys = new Set(linkedSessionKeys)
    return all
      .filter((l: any) => (l.session && keys.has(l.session)) || (l.data?.sessionKey && keys.has(l.data.sessionKey)))
      .slice(-400)
  }, [logs, linkedSessionKeys])

  const sendToConductor = async () => {
    const text = message.trim()
    if (!text) return
    setSendStatus(null)

    // Prefer to forward to Conductor (so the team sees it).
    // If Conductor isn't online, it'll still be stored in the coord conversation.
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'anton',
          to: 'Conductor',
          content: text,
          conversation_id: coordConversationId,
          message_type: 'text',
          forward: true,
        }),
      })
      if (!res.ok) throw new Error('send failed')
      setMessage('')
      setSendStatus('Sent to Conductor')
    } catch {
      setSendStatus('Failed to send (see logs)')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">Linked OpenClaw sessions</div>
        {linkedSessionKeys.length === 0 ? (
          <div className="text-sm text-muted-foreground mt-1">
            No linked sessions found on this task. (Expected under metadata.openclaw.sessions)
          </div>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {linkedSessionKeys.map((k) => (
              <li key={k} className="font-mono text-xs break-all bg-muted/40 rounded px-2 py-1">
                {k}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Team chat (coordination)</div>
            <div className="text-xs text-muted-foreground font-mono">{coordConversationId}</div>
          </div>

          <div className="mt-3 h-64 overflow-auto rounded bg-muted/20 p-2 space-y-2">
            {messages.length === 0 ? (
              <div className="text-sm text-muted-foreground">No messages yet.</div>
            ) : (
              messages.map((m: any) => (
                <div key={m.id ?? `${m.created_at}-${m.from_agent}-${m.content?.slice(0, 10)}`} className="text-sm">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.from_agent}</span>
                    {m.to_agent ? <span> → {m.to_agent}</span> : null}
                    <span className="ml-2">{new Date((m.created_at ?? 0) * 1000).toLocaleString()}</span>
                    <span className="ml-2 font-mono">[{m.conversation_id}]</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm"
              placeholder="Message Conductor / team…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendToConductor()
                }
              }}
            />
            <button
              className="px-3 py-2 rounded bg-primary text-primary-foreground text-sm"
              onClick={sendToConductor}
            >
              Send
            </button>
          </div>
          {sendStatus ? <div className="mt-2 text-xs text-muted-foreground">{sendStatus}</div> : null}
        </div>

        <div className="border border-border rounded-lg p-3">
          <div className="text-sm font-medium">Live logs (linked sessions)</div>
          <div className="mt-3 h-64 overflow-auto rounded bg-muted/20 p-2 space-y-2">
            {sessionLogs.length === 0 ? (
              <div className="text-sm text-muted-foreground">No session logs captured yet.</div>
            ) : (
              sessionLogs.map((l: any) => (
                <div key={l.id ?? `${l.timestamp}-${l.message?.slice(0, 20)}`} className="text-xs">
                  <div className="text-muted-foreground">
                    <span className="font-mono">{new Date(l.timestamp ?? Date.now()).toLocaleTimeString()}</span>
                    <span className="ml-2">{l.level?.toUpperCase?.() ?? 'INFO'}</span>
                    {l.session ? <span className="ml-2 font-mono">[{l.session}]</span> : null}
                  </div>
                  <div className="font-mono whitespace-pre-wrap break-words">{l.message}</div>
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Tip: This becomes a true “office group chat” once agents route comms through conversation <span className="font-mono">{coordConversationId}</span>.
          </div>
        </div>
      </div>
    </div>
  )
}
