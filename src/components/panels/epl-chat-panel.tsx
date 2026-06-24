'use client'

/**
 * EPL Agent Cockpit — Chat (Phase 2).
 *
 * Conversational dispatch over the existing Atlas bridge. Sending a turn POSTs
 * to /api/epl/chat (→ Atlas /dispatch with a thread_id, returns 202), then the
 * panel POLLS /api/epl/chat/[thread_id] every POLL_MS (≥3s) until the turn
 * completes or POLL_TIMEOUT_MS elapses. No WebSocket/SSE — plain polling keeps
 * the box load bounded (the 23 Jun crash-loop lesson). Per-turn cost is shown.
 *
 * Read-only Q&A flows straight through. A turn that triggers an ACTION keeps
 * Atlas's approval gate → the poll returns status 'awaiting_approval' and the
 * panel points the user at the Approvals inbox (Panel 5) instead of hanging.
 *
 * 🔒 Gated behind COCKPIT_CHAT_ENABLED (default OFF): the panel only registers
 * when the flag is on (src/plugins/epl-panels.ts) and both chat routes 404 when
 * off. The interactive chat is INERT in prod until armed under supervision.
 */

import { useCallback, useRef, useState } from 'react'
import { cockpitChatEnabled } from '@/lib/cockpit-flags'

const POLL_MS = 3000 // ≥3s per spec — no tighter
const POLL_TIMEOUT_MS = 180_000 // hard per-turn ceiling
const AGENTS = ['atlas', 'james', 'aria', 'victoria', 'iris', 'larry', 'cleo', 'sofia', 'marcus', 'leo', 'nina']

type Role = 'user' | 'agent' | 'system'
interface Msg {
  role: Role
  text: string
  cost_usd?: number
  awaiting_approval?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function EplChatPanel() {
  const enabled = cockpitChatEnabled()
  const [agent, setAgent] = useState('atlas')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const threadRef = useRef<string | null>(null)

  const pushSystem = (text: string) => setMsgs((m) => [...m, { role: 'system', text }])

  const send = useCallback(async () => {
    const message = input.trim()
    if (!message || sending) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: message }])
    setSending(true)

    try {
      const res = await fetch('/api/epl/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, thread_id: threadRef.current ?? undefined, message }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status !== 202 || body.ok === false) {
        pushSystem(body.error || `dispatch failed (${res.status})`)
        return
      }
      threadRef.current = body.thread_id

      // Poll for the reply — ≥3s interval, hard timeout.
      const deadline = Date.now() + POLL_TIMEOUT_MS
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() > deadline) {
          pushSystem('Timed out waiting for a reply — the turn may still be running on Atlas.')
          return
        }
        await sleep(POLL_MS)
        const pres = await fetch(`/api/epl/chat/${encodeURIComponent(body.thread_id)}`, { cache: 'no-store' })
        const pbody = await pres.json().catch(() => ({}))
        if (!pres.ok) {
          pushSystem(pbody.error || `poll failed (${pres.status})`)
          return
        }
        if (pbody.status === 'pending' || pbody.status === 'in_progress' || pbody.status === 'running') {
          continue
        }
        if (pbody.status === 'awaiting_approval' || pbody.awaiting_approval) {
          setMsgs((m) => [
            ...m,
            {
              role: 'agent',
              text: pbody.reply || 'This turn triggers an action — it needs approval. Open the Approvals inbox to release or reject it.',
              cost_usd: pbody.cost_usd,
              awaiting_approval: true,
            },
          ])
          return
        }
        // done / failed / anything terminal with a reply
        setMsgs((m) => [
          ...m,
          { role: 'agent', text: pbody.reply || '(no reply text)', cost_usd: pbody.cost_usd },
        ])
        return
      }
    } catch (e) {
      pushSystem(String(e))
    } finally {
      setSending(false)
    }
  }, [agent, input, sending])

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4 flex flex-col h-full">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">💬 Cockpit chat</h1>
        <select
          value={agent}
          onChange={(e) => { setAgent(e.target.value); threadRef.current = null; setMsgs([]) }}
          className="text-xs rounded-lg border border-border bg-muted px-2 py-1 text-foreground"
        >
          {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">read-only Q&amp;A · action turns need approval</span>
      </header>

      <section className="flex-1 space-y-3 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="text-sm text-muted-foreground">Ask {agent} a question. Read-only answers come back here; anything that writes/sends drops into the Approvals inbox.</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
              m.role === 'user' ? 'bg-blue-600/30 text-foreground'
              : m.role === 'system' ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
              : 'bg-secondary text-secondary-foreground'
            }`}>
              <div className="text-[11px] text-muted-foreground capitalize mb-0.5">
                {m.role === 'agent' ? agent : m.role}
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
              {(m.cost_usd != null || m.awaiting_approval) && (
                <div className="text-[11px] text-muted-foreground mt-1 flex gap-2">
                  {m.cost_usd != null && <span>${m.cost_usd.toFixed(4)}</span>}
                  {m.awaiting_approval && <span className="text-amber-300">→ Approvals inbox</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && <div className="text-xs text-muted-foreground">…waiting for {agent}</div>}
      </section>

      <div className="flex gap-2 items-center border-t border-border pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          disabled={sending}
          placeholder={sending ? 'Waiting for reply…' : `Message ${agent}…`}
          className="flex-1 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground disabled:opacity-60"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm"
        >
          Send
        </button>
      </div>
    </div>
  )
}
