'use client'

import { StatRow, type DashboardData } from '../widget-primitives'

export function GithubSignalWidget({ data }: { data: DashboardData }) {
  const { githubStats, isGithubLoading } = data

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">GitHub Signal</h3>
        {githubStats?.user && <span className="text-2xs text-muted-foreground font-mono-tight">@{githubStats.user.login}</span>}
      </div>
      <div className="panel-body space-y-3">
        {githubStats ? (
          <>
            <StatRow label="Active repos" value={githubStats.repos.total} />
            <StatRow label="Public / Private" value={`${githubStats.repos.public} / ${githubStats.repos.private}`} />
            <StatRow label="Open issues" value={githubStats.repos.total_open_issues} />
            <StatRow label="Stars" value={githubStats.repos.total_stars} />
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground">{isGithubLoading ? 'Loading GitHub stats...' : 'No GitHub token configured'}</p>
            {!isGithubLoading && <p className="text-2xs text-muted-foreground/60 mt-1">Set GITHUB_TOKEN in .env.local</p>}
          </div>
        )}
      </div>
    </div>
  )
}
