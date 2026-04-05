'use client'

import type { SyncRecord } from './github-sync-panel-types'

interface SyncHistoryTableProps {
  records: SyncRecord[]
}

export function SyncHistoryTable({ records }: SyncHistoryTableProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">Sync History</h3>
      </div>
      {records.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Repo</th>
                <th className="text-left px-4 py-2 font-medium">Issues</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Synced At</th>
              </tr>
            </thead>
            <tbody>
              {records.map(sync => (
                <SyncHistoryRow key={sync.id} sync={sync} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No sync history yet. Import issues above to get started.
        </div>
      )}
    </div>
  )
}

interface SyncHistoryRowProps {
  sync: SyncRecord
}

function SyncHistoryRow({ sync }: SyncHistoryRowProps): React.JSX.Element {
  const statusClass =
    sync.status === 'success'
      ? 'bg-green-500/10 text-green-400'
      : sync.status === 'partial'
      ? 'bg-yellow-500/10 text-yellow-400'
      : 'bg-destructive/10 text-destructive'

  return (
    <tr className="border-b border-border/50 hover:bg-secondary/50">
      <td className="px-4 py-2 font-mono text-foreground">{sync.repo}</td>
      <td className="px-4 py-2 text-muted-foreground">{sync.issue_count}</td>
      <td className="px-4 py-2">
        <span className={`px-1.5 py-0.5 rounded text-2xs ${statusClass}`}>
          {sync.status}
        </span>
      </td>
      <td className="px-4 py-2 text-muted-foreground">
        {new Date(sync.created_at * 1000).toLocaleString()}
      </td>
    </tr>
  )
}
