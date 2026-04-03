'use client'

/** Animated placeholder shown while the task board loads its initial data. */
export function TaskBoardSkeleton() {
  return (
    <div className="h-full flex flex-col" role="status" aria-live="polite">
      <SkeletonHeader />
      <SkeletonColumns />
      <span className="sr-only">Loading tasks...</span>
    </div>
  )
}

function SkeletonHeader() {
  return (
    <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="h-7 w-28 bg-surface-1 rounded-md animate-pulse" />
        <div className="h-9 w-36 bg-surface-1 rounded-md animate-pulse" />
      </div>
      <div className="flex gap-2">
        <div className="h-9 w-20 bg-surface-1 rounded-md animate-pulse" />
        <div className="h-9 w-24 bg-surface-1 rounded-md animate-pulse" />
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-surface-1 rounded-lg p-3 border-l-4 border-border space-y-2 animate-pulse">
      <div className="h-4 w-3/4 bg-surface-2 rounded" />
      <div className="h-3 w-full bg-surface-2/60 rounded" />
      <div className="h-3 w-1/2 bg-surface-2/40 rounded" />
      <div className="flex justify-between items-center pt-1">
        <div className="h-3 w-20 bg-surface-2/50 rounded" />
        <div className="h-3 w-16 bg-surface-2/50 rounded" />
      </div>
    </div>
  )
}

function SkeletonColumn({ cardCount }: { cardCount: number }) {
  return (
    <div className="flex-1 min-w-80 bg-card border border-border rounded-lg flex flex-col">
      <div className="p-3 rounded-t-lg bg-surface-1 animate-pulse">
        <div className="h-5 w-24 bg-surface-2 rounded" />
      </div>
      <div className="flex-1 p-3 space-y-3">
        {Array.from({ length: cardCount }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  )
}

function SkeletonColumns() {
  // Descending card counts mirror realistic board density
  const cardCounts = [3, 2, 1, 0]
  return (
    <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
      {cardCounts.map((count, i) => (
        <SkeletonColumn key={i} cardCount={count} />
      ))}
    </div>
  )
}
