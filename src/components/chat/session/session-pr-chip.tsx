'use client'

export function SessionPrChip({
  number,
  repo,
  branch,
  additions,
  deletions,
  href,
  onDismiss,
}: {
  number: number
  repo: string
  branch?: string
  additions?: number
  deletions?: number
  href?: string
  onDismiss?: () => void
}) {
  const body = (
    <>
      <span className="text-[var(--chat-success)]">#{number}</span>
      <span className="truncate text-[var(--chat-muted)]">{repo}</span>
      {branch ? <span className="truncate text-[var(--chat-text)]">{branch}</span> : null}
      {additions != null && (
        <span className="text-[var(--chat-success)]">+{additions.toLocaleString()}</span>
      )}
      {deletions != null && (
        <span className="text-[var(--chat-danger)]">-{deletions.toLocaleString()}</span>
      )}
    </>
  )

  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] px-3 py-2 text-[12px]">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-2">
          {body}
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-[var(--chat-muted)] hover:text-[var(--chat-text)]" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}
