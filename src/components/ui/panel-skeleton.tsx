/**
 * Lightweight loading placeholder shown while panel components
 * are being lazy-loaded via next/dynamic code splitting.
 */
export function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 animate-pulse" aria-busy="true" aria-label="Loading panel">
      {/* Title bar */}
      <div className="h-6 w-48 rounded bg-muted" />
      {/* Subtitle */}
      <div className="h-4 w-72 rounded bg-muted/60" />
      {/* Content blocks */}
      <div className="mt-4 grid gap-4">
        <div className="h-32 rounded-lg bg-muted/40" />
        <div className="h-24 rounded-lg bg-muted/40" />
      </div>
    </div>
  )
}
