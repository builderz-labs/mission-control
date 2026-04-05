'use client'

import type { GitHubIssue } from './github-sync-panel-types'

interface IssuePreviewTableProps {
  issues: GitHubIssue[]
}

export function IssuePreviewTable({ issues }: IssuePreviewTableProps): React.JSX.Element | null {
  if (issues.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Preview ({issues.length} issues)
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">#</th>
              <th className="text-left px-4 py-2 font-medium">Title</th>
              <th className="text-left px-4 py-2 font-medium">Labels</th>
              <th className="text-left px-4 py-2 font-medium">State</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {issues.map(issue => (
              <IssueRow key={issue.number} issue={issue} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface IssueRowProps {
  issue: GitHubIssue
}

function IssueRow({ issue }: IssueRowProps): React.JSX.Element {
  return (
    <tr className="border-b border-border/50 hover:bg-secondary/50">
      <td className="px-4 py-2 text-muted-foreground">{issue.number}</td>
      <td className="px-4 py-2 text-foreground max-w-[300px] truncate">
        <a
          href={issue.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          {issue.title}
        </a>
      </td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {issue.labels.map(l => (
            <span
              key={l.name}
              className="px-1.5 py-0.5 rounded text-2xs bg-secondary text-muted-foreground"
            >
              {l.name}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-2">
        <span className={`px-1.5 py-0.5 rounded text-2xs ${
          issue.state === 'open'
            ? 'bg-green-500/10 text-green-400'
            : 'bg-purple-500/10 text-purple-400'
        }`}>
          {issue.state}
        </span>
      </td>
      <td className="px-4 py-2 text-muted-foreground">
        {new Date(issue.created_at).toLocaleDateString()}
      </td>
    </tr>
  )
}
