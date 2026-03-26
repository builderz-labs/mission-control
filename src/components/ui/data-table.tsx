'use client'

import { useState, useCallback, useMemo } from 'react'

export interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  numeric?: boolean // renders in monospace, right-aligned
  monetary?: boolean // like numeric but also color-codes positive/negative
  width?: string // e.g. '120px', '20%'
  render?: (row: T, index: number) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyField: string // field name to use as React key
  emptyMessage?: string
  emptyAction?: { label: string; onClick: () => void }
  maxHeight?: string // e.g. '400px' for scrollable body with fixed header
  className?: string
  onRowClick?: (row: T) => void
}

type SortDir = 'asc' | 'desc'

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField,
  emptyMessage = 'No data available.',
  emptyAction,
  maxHeight,
  className = '',
  onRowClick,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }, [sortKey])

  const sortedData = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
  }, [data, sortKey, sortDir])

  if (data.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
        <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>
        {emptyAction && (
          <button
            onClick={emptyAction.onClick}
            className="mt-2 text-sm text-[var(--blue)] hover:underline"
          >
            {emptyAction.label}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`border border-[var(--border)] rounded-md overflow-hidden ${className}`}>
      <div className={maxHeight ? `overflow-auto` : ''} style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--surface)] border-b border-[var(--border)]">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider ${
                    col.numeric || col.monetary ? 'text-right' : ''
                  } ${col.sortable ? 'cursor-pointer select-none hover:text-[var(--text-secondary)]' : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <SortChevron direction={sortDir} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, idx) => (
              <tr
                key={String(row[keyField])}
                className={`border-b border-[var(--border)] last:border-b-0 ${
                  idx % 2 === 0 ? 'bg-[var(--bg,var(--background))]' : 'bg-transparent'
                } ${onRowClick ? 'cursor-pointer hover:bg-[var(--surface-hover,var(--surface-2))]' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map(col => {
                  const value = row[col.key]
                  const isMonetary = col.monetary
                  const isNumeric = col.numeric || isMonetary

                  let content: React.ReactNode
                  if (col.render) {
                    content = col.render(row, idx)
                  } else if (isMonetary && typeof value === 'number') {
                    const colorClass = value > 0 ? 'text-[#22c55e]' : value < 0 ? 'text-[#ef4444]' : 'text-[var(--text-secondary)]'
                    content = (
                      <span className={`font-mono tabular-nums ${colorClass}`}>
                        {value > 0 ? '+' : ''}{value.toLocaleString()}
                      </span>
                    )
                  } else if (isNumeric) {
                    content = (
                      <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {value != null ? String(value) : '—'}
                      </span>
                    )
                  } else {
                    content = <span className="text-[var(--text-primary,var(--foreground))]">{value != null ? String(value) : '—'}</span>
                  }

                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${isNumeric ? 'text-right' : ''}`}
                    >
                      {content}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortChevron({ direction }: { direction: SortDir }) {
  return (
    <svg
      className={`w-3 h-3 ${direction === 'desc' ? 'rotate-180' : ''}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8L6 5L9 8" />
    </svg>
  )
}
