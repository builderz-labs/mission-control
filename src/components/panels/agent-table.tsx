'use client'

import { useState, useMemo } from 'react'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import { Agent } from '@/store/index'
import { getAgentIdentity, getFreshnessLabel, FleetTier, TIER_META } from '@/lib/agent-identity'

interface AgentTableProps {
  agents: Agent[]
  onSelectAgent: (agent: Agent) => void
  statusFilter?: string // 'all' | 'running' | 'idle' | 'offline' | 'error'
  className?: string
}

type MappedStatus = 'running' | 'idle' | 'offline' | 'crashed'

function mapAgentStatus(status: Agent['status']): MappedStatus {
  if (status === 'busy') return 'running'
  if (status === 'error') return 'crashed'
  if (status === 'idle') return 'idle'
  if (status === 'offline') return 'offline'
  return 'idle'
}

const TIER_COLORS: Record<FleetTier, string> = {
  operator: 'text-[#3b82f6]',
  primary: 'text-[#22c55e]',
  devtools: 'text-[#71717a]',
  external: 'text-[#f59e0b]',
  hidden: 'text-[#71717a]',
}

type AgentRow = Record<string, unknown> & {
  id: number
  name: string
  status: Agent['status']
  last_seen?: number
  taskStats?: Agent['taskStats']
  _agent: Agent
}

const FILTER_BUTTONS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'idle', label: 'Idle' },
  { key: 'offline', label: 'Offline' },
  { key: 'error', label: 'Error' },
]

export function AgentTable({
  agents,
  onSelectAgent,
  statusFilter: externalFilter,
  className,
}: AgentTableProps) {
  const [internalFilter, setInternalFilter] = useState<string>('all')

  // If an external filter is provided, use it; otherwise use internal state
  const activeFilter = externalFilter !== undefined ? externalFilter : internalFilter

  const filteredAgents = useMemo(() => {
    if (activeFilter === 'all') return agents
    if (activeFilter === 'running') return agents.filter(a => a.status === 'busy' || a.status === 'idle')
    if (activeFilter === 'idle') return agents.filter(a => a.status === 'idle')
    if (activeFilter === 'offline') return agents.filter(a => a.status === 'offline')
    if (activeFilter === 'error') return agents.filter(a => a.status === 'error')
    return agents
  }, [agents, activeFilter])

  const runningCount = useMemo(
    () => agents.filter(a => a.status === 'busy' || a.status === 'idle').length,
    [agents]
  )
  const errorCount = useMemo(
    () => agents.filter(a => a.status === 'error').length,
    [agents]
  )

  const tableData: AgentRow[] = useMemo(
    () =>
      filteredAgents.map(agent => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        last_seen: agent.last_seen,
        taskStats: agent.taskStats,
        _agent: agent,
      })),
    [filteredAgents]
  )

  const columns: Column<AgentRow>[] = [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      width: '200px',
      render: (row) => {
        const identity = getAgentIdentity(row.name as string)
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-sm text-[var(--text-primary)]">{row.name as string}</span>
            <span className="text-xs text-[var(--text-muted)]">{identity.roleTitle}</span>
          </div>
        )
      },
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '100px',
      render: (row) => {
        const mapped = mapAgentStatus(row.status as Agent['status'])
        return <StatusBadge status={mapped} size="sm" />
      },
    },
    {
      key: 'tier',
      label: 'Tier',
      sortable: true,
      width: '120px',
      render: (row) => {
        const tier = getAgentIdentity(row.name as string).tier
        const colorClass = TIER_COLORS[tier]
        return (
          <span className={`text-xs ${colorClass}`}>
            {TIER_META[tier].label}
          </span>
        )
      },
    },
    {
      key: 'last_seen',
      label: 'Last Seen',
      sortable: true,
      width: '140px',
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-secondary)]">
          {getFreshnessLabel(row.last_seen as number | undefined)}
        </span>
      ),
    },
    {
      key: 'taskStats',
      label: 'Tasks',
      sortable: true,
      width: '100px',
      render: (row) => {
        const stats = row.taskStats as Agent['taskStats']
        const active = stats?.in_progress ?? 0
        const done = stats?.done ?? 0
        return (
          <span className="font-mono text-xs text-[var(--text-secondary)]">
            {active} active / {done} done
          </span>
        )
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      width: '80px',
      render: (row) => (
        <button
          className="text-xs text-[#3b82f6] hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            onSelectAgent(row._agent as Agent)
          }}
        >
          View
        </button>
      ),
    },
  ]

  return (
    <div className={className}>
      {/* Filter bar */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-0">
          {FILTER_BUTTONS.map((btn) => (
            <button
              key={btn.key}
              onClick={() => setInternalFilter(btn.key)}
              className={`px-3 py-1 text-xs transition-colors ${
                activeFilter === btn.key
                  ? 'text-[#3b82f6] border-b-2 border-[#3b82f6]'
                  : 'text-[var(--text-muted)] border-b-2 border-transparent hover:text-[var(--text-secondary)]'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-muted)] ml-auto">
          {agents.length} agents · {runningCount} running · {errorCount} errors
        </span>
      </div>

      {/* Table */}
      <DataTable<AgentRow>
        columns={columns}
        data={tableData}
        keyField="id"
        emptyMessage="No agents found. Deploy one from chat: 'start an agent'"
        maxHeight="calc(100vh - 200px)"
        onRowClick={(row) => onSelectAgent(row._agent as Agent)}
      />
    </div>
  )
}

export default AgentTable
