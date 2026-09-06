import type { DbStats } from './widget-primitives'

export interface DashboardSystemStats {
  error?: string
  cpu?: { usage?: number }
  memory?: { total: number; used: number }
  disk?: { usage?: string }
  uptime?: number
  db?: DbStats
}

export interface DashboardGitHubStats {
  error?: string
  user?: { login?: string }
  repos: {
    total: number
    public: number
    private: number
    total_open_issues: number
    total_stars: number
  }
}
