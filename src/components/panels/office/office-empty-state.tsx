'use client'

// Shown when the agent roster is empty — no agents deployed yet.

export function OfficeEmptyState(): React.ReactElement {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-12 h-12 mx-auto mb-3 text-void-cyan/30"
      >
        <path d="M8 1l6 4v6l-6 4-6-4V5l6-4z" />
        <path d="M8 1v14M2 5l6 4 6-4" />
      </svg>
      <p className="text-lg">The deck is empty</p>
      <p className="text-sm mt-1">Deploy agents to see them appear here</p>
    </div>
  )
}
