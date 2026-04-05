'use client'

import type { FeedbackState, SyncResult, TokenStatus } from './github-sync-panel-types'

interface LoadingSpinnerProps {
  label?: string
}

export function LoadingSpinner({ label = 'Loading...' }: LoadingSpinnerProps): React.JSX.Element {
  return (
    <div className="p-6 flex flex-col items-center justify-center gap-3 min-h-[200px]">
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

interface ErrorBannerProps {
  message: string
  onRetry: () => void
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps): React.JSX.Element {
  return (
    <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300"
      >
        Retry
      </button>
    </div>
  )
}

interface FeedbackBannerProps {
  feedback: FeedbackState
}

export function FeedbackBanner({ feedback }: FeedbackBannerProps): React.JSX.Element {
  return (
    <div className={`rounded-lg p-3 text-xs font-medium ${
      feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
    }`}>
      {feedback.text}
    </div>
  )
}

interface SyncResultBannerProps {
  result: SyncResult
}

export function SyncResultBanner({ result }: SyncResultBannerProps): React.JSX.Element {
  return (
    <div className="rounded-lg p-3 text-xs bg-blue-500/10 text-blue-400 flex items-center gap-4">
      <span>Imported: {result.imported}</span>
      <span>Skipped: {result.skipped}</span>
      {result.errors > 0 && (
        <span className="text-destructive">Errors: {result.errors}</span>
      )}
    </div>
  )
}

interface ConnectionHeaderProps {
  tokenStatus: TokenStatus | null
}

export function ConnectionHeader({ tokenStatus }: ConnectionHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-foreground">GitHub Issues Sync</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Import GitHub issues as Ultron tasks
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-2xs px-2 py-1 rounded flex items-center gap-1.5 ${
          tokenStatus?.connected
            ? 'bg-green-500/10 text-green-400'
            : 'bg-destructive/10 text-destructive'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            tokenStatus?.connected ? 'bg-green-500' : 'bg-destructive'
          }`} />
          {tokenStatus?.connected
            ? `GitHub: ${tokenStatus.user || 'connected'}`
            : 'GitHub: not configured'}
        </span>
      </div>
    </div>
  )
}

interface NotConfiguredNoticeProps {
  tokenStatus: TokenStatus | null
}

export function NotConfiguredNotice({ tokenStatus }: NotConfiguredNoticeProps): React.JSX.Element | null {
  if (!tokenStatus || tokenStatus.connected) return null

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <span className="text-amber-400 text-lg mt-0.5">!</span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">GitHub token not configured</p>
          <p className="text-xs text-muted-foreground">
            Set{' '}
            <code className="px-1 py-0.5 rounded bg-secondary text-foreground font-mono text-2xs">
              GITHUB_TOKEN
            </code>{' '}
            in Integrations to enable issue sync. You can still browse sync history and linked tasks below.
          </p>
        </div>
      </div>
    </div>
  )
}
