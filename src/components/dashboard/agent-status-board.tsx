'use client'

import type { MissionControlAgentRow } from '@/types/mission-control'

export function AgentStatusBoard({ agents }: { agents: MissionControlAgentRow[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Agent Status Board</h2>
        <span className="text-2xs font-medium text-muted-foreground">{agents.length} agents</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead className="border-b border-border/60 text-2xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Thinking</th>
              <th className="px-4 py-3 font-medium">Task</th>
              <th className="px-4 py-3 font-medium">Tool</th>
              <th className="px-4 py-3 font-medium">Progress</th>
              <th className="px-4 py-3 font-medium">Updated</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.agentId} className="border-b border-border/40 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{agent.agentName}</div>
                  <div className="mt-1 text-2xs text-muted-foreground line-clamp-2">{agent.summary || 'No recent activity'}</div>
                  {agent.blocker && (
                    <div className="mt-2 inline-flex rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-2xs text-red-400">
                      {agent.blocker}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground">{agent.stage}</td>
                <td className="px-4 py-3 text-foreground/90">
                  <div className="max-w-xs text-xs">{agent.thinkingSummary || '-'}</div>
                  {(agent.model || agent.tokenUsage || agent.latency) && (
                    <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted-foreground">
                      {agent.model && <span>{agent.model}</span>}
                      {agent.tokenUsage != null && <span>{agent.tokenUsage} tok</span>}
                      {agent.latency != null && <span>{agent.latency} ms</span>}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground/90">{agent.task || '-'}</td>
                <td className="px-4 py-3 text-muted-foreground">{agent.tool || '-'}</td>
                <td className="px-4 py-3 text-foreground">{agent.progressPct != null ? `${agent.progressPct}%` : '-'}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatRelative(agent.lastEventTs)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-medium uppercase ${
                    agent.status === 'active'
                      ? 'bg-green-500/10 text-green-400'
                      : agent.status === 'idle'
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {agent.status}
                  </span>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No agents available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatRelative(ts?: string) {
  if (!ts) return '-'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
