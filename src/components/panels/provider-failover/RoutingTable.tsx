'use client'

import { RoutingRule } from './types'

interface RoutingTableProps {
  rules: RoutingRule[]
  onToggle: (rule: RoutingRule) => void
  onDelete: (id: number) => void
  onShift: (rule: RoutingRule, direction: 'up' | 'down') => void
}

const TABLE_HEADERS = ['Provider', 'Priority', 'Status', 'Max Retries', 'Timeout', 'Tags', 'Actions']

export function RoutingTable({
  rules,
  onToggle,
  onDelete,
  onShift,
}: RoutingTableProps): React.JSX.Element {
  if (rules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        No providers configured yet. Add anthropic, openai, or cohere to get started.
      </div>
    )
  }

  const sorted = [...rules].sort((a, b) => a.priority - b.priority)

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {TABLE_HEADERS.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((rule, idx) => (
            <RoutingRow
              key={rule.id}
              rule={rule}
              idx={idx}
              total={sorted.length}
              onToggle={onToggle}
              onDelete={onDelete}
              onShift={onShift}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface RoutingRowProps {
  rule: RoutingRule
  idx: number
  total: number
  onToggle: (rule: RoutingRule) => void
  onDelete: (id: number) => void
  onShift: (rule: RoutingRule, direction: 'up' | 'down') => void
}

function RoutingRow({
  rule,
  idx,
  total,
  onToggle,
  onDelete,
  onShift,
}: RoutingRowProps): React.JSX.Element {
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/20">
      <td className="px-3 py-2 font-medium capitalize">{rule.provider}</td>
      <td className="px-3 py-2 text-muted-foreground">{rule.priority}</td>
      <td className="px-3 py-2">
        <button
          onClick={() => onToggle(rule)}
          className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
            rule.enabled ? 'bg-green-500' : 'bg-muted'
          }`}
          aria-label={rule.enabled ? 'Disable' : 'Enable'}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
              rule.enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{rule.max_retries}</td>
      <td className="px-3 py-2 text-muted-foreground">{rule.timeout_ms.toLocaleString()}ms</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {rule.capability_tags.length === 0 ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            rule.capability_tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 text-xs"
              >
                {tag}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onShift(rule, 'up')}
            disabled={idx === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
            aria-label="Increase priority"
          >
            ▲
          </button>
          <button
            onClick={() => onShift(rule, 'down')}
            disabled={idx === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
            aria-label="Decrease priority"
          >
            ▼
          </button>
          <button
            onClick={() => onDelete(rule.id)}
            className="ml-1 text-red-400 hover:text-red-300 px-1 text-xs"
            aria-label="Delete"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  )
}
