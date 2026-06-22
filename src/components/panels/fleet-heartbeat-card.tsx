"use client"

import { useState, useEffect } from "react"

interface HeartbeatAgent {
  name: string
  status: "live" | "stale" | "drift" | "down" | "unknown"
  last_action: string | null
  last_action_at: string | null
  cost_today_usd: number
  tasks_today: number
  drift: boolean
  session_last_age_hours: number | null
  notes: string[]
}

interface HeartbeatPayload {
  schema_version: string
  atlas_version: string
  timestamp: string
  host: string
  spend_today_usd: number
  sub_sessions_today: number
  pending_approvals: number
  agents: HeartbeatAgent[]
}

interface HeartbeatHost {
  host: string
  received_at: number
  payload: HeartbeatPayload
}

const STATUS_COLOR: Record<HeartbeatAgent["status"], string> = {
  live: "bg-emerald-500",
  stale: "bg-amber-500",
  drift: "bg-orange-500",
  down: "bg-red-500",
  unknown: "bg-slate-500",
}

const STATUS_LABEL: Record<HeartbeatAgent["status"], string> = {
  live: "live",
  stale: "stale",
  drift: "drift",
  down: "down",
  unknown: "?",
}

function relativeTime(epochSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - epochSeconds
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function FleetHeartbeatCard() {
  const [hosts, setHosts] = useState<HeartbeatHost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchHeartbeat = async () => {
      try {
        const res = await fetch("/api/agents/heartbeat")
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return
        setHosts(data.hosts || [])
        setError(null)
        setLastFetched(Math.floor(Date.now() / 1000))
      } catch (err: any) {
        if (cancelled) return
        setError(err?.message || "Failed to fetch heartbeat")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchHeartbeat()
    const interval = setInterval(fetchHeartbeat, 30000) // 30s — Atlas pushes every 5min, 30s is plenty
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (loading && hosts.length === 0) {
    return (
      <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-4 m-4">
        <div className="text-slate-400 text-sm">Loading Atlas heartbeat…</div>
      </div>
    )
  }

  if (error && hosts.length === 0) {
    return (
      <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 m-4">
        <div className="text-red-300 text-sm">
          Atlas heartbeat unavailable: {error}
        </div>
        <div className="text-slate-400 text-xs mt-1">
          Endpoint: <code>/api/agents/heartbeat</code> — Atlas may not be reporting
          (check <code>atlas-heartbeat.timer</code> on VPS).
        </div>
      </div>
    )
  }

  if (hosts.length === 0) {
    return (
      <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-4 m-4">
        <div className="text-slate-400 text-sm">
          No heartbeat data yet. Atlas pushes every 5 min — first snapshot
          arrives after the next timer fire.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-4 my-4 space-y-3">
      {hosts.map((h) => {
        const p = h.payload
        const totalAgents = p.agents?.length || 0
        const liveCount = p.agents?.filter((a) => a.status === "live").length || 0
        return (
          <div
            key={h.host}
            className="bg-slate-800/60 border border-slate-700 rounded-lg p-4"
          >
            <div className="flex flex-wrap items-baseline gap-3 mb-3">
              <div className="text-sm font-semibold text-slate-100">
                Fleet — {h.host}
              </div>
              <div className="text-xs text-slate-400">
                Atlas {p.atlas_version} · snapshot {relativeTime(h.received_at)}
              </div>
              <div className="ml-auto flex gap-3 text-xs text-slate-300">
                <span>
                  <span className="text-slate-500">spend today</span>{" "}
                  <span className="font-mono">${p.spend_today_usd.toFixed(2)}</span>
                </span>
                <span>
                  <span className="text-slate-500">sub-sessions</span>{" "}
                  <span className="font-mono">{p.sub_sessions_today}</span>
                </span>
                <span>
                  <span className="text-slate-500">pending</span>{" "}
                  <span
                    className={`font-mono ${
                      p.pending_approvals > 0
                        ? "text-amber-300"
                        : "text-slate-300"
                    }`}
                  >
                    {p.pending_approvals}
                  </span>
                </span>
                <span>
                  <span className="text-slate-500">live</span>{" "}
                  <span className="font-mono text-emerald-300">
                    {liveCount}/{totalAgents}
                  </span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {p.agents?.map((a) => {
                const sessionAge =
                  a.session_last_age_hours !== null
                    ? `${Math.floor(a.session_last_age_hours)}h`
                    : null
                return (
                  <div
                    key={a.name}
                    className="bg-slate-900/60 border border-slate-700 rounded p-2 hover:border-slate-500 transition"
                    title={
                      a.last_action_at
                        ? `Last action: ${a.last_action || "—"} at ${a.last_action_at}`
                        : `Session age: ${sessionAge || "n/a"}`
                    }
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className={`w-2 h-2 rounded-full ${STATUS_COLOR[a.status]}`}
                      />
                      <span className="text-sm font-medium text-slate-100 truncate">
                        {a.name}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>{STATUS_LABEL[a.status]}</span>
                      {a.drift && (
                        <span className="text-orange-400" title="Mac HEAD ≠ VPS HEAD">
                          drift
                        </span>
                      )}
                      {sessionAge && !a.drift && (
                        <span>{sessionAge}</span>
                      )}
                    </div>
                    {a.cost_today_usd > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                        ${a.cost_today_usd.toFixed(3)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {lastFetched && (
              <div className="text-[10px] text-slate-600 mt-2">
                UI refreshed {relativeTime(lastFetched)} · auto every 30s
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
