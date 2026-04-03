'use client'

import { Button } from '@/components/ui/button'

export interface NavItemData {
  id: string
  label: string
  icon: React.ReactNode
  priority: boolean
  essential?: boolean
  children?: NavItemData[]
}

interface NavButtonProps {
  item: NavItemData
  active: boolean
  expanded: boolean
  onClick: () => void
  onPrefetch?: () => void
  nested?: boolean
}

/** Single navigation button — renders as full-width labeled row (expanded) or icon-only with tooltip (collapsed) */
export function NavButton({ item, active, expanded, onClick, onPrefetch, nested }: NavButtonProps) {
  if (expanded) {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        aria-current={active ? 'page' : undefined}
        className={`w-full flex items-center gap-2 px-2 h-auto rounded-lg text-left justify-start relative ${
          nested ? 'py-1' : 'py-1.5'
        } ${
          active
            ? 'bg-primary/15 text-primary hover:bg-primary/20'
            : ''
        }`}
      >
        {active && (
          <span className="absolute left-0 w-0.5 h-5 bg-void-cyan rounded-r glow-cyan" />
        )}
        <div className={`shrink-0 ${nested ? 'w-4 h-4' : 'w-5 h-5'}`}>{item.icon}</div>
        <span className={`truncate ${nested ? 'text-xs' : 'text-sm'}`}>{item.label}</span>
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg group relative ${
        active
          ? 'bg-primary/15 text-primary hover:bg-primary/20'
          : ''
      }`}
    >
      <div className="w-5 h-5">{item.icon}</div>
      {/* Tooltip shown on hover in collapsed mode */}
      <span className="absolute left-full ml-2 px-2 py-1 text-xs font-medium bg-popover text-popover-foreground border border-border rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
        {item.label}
      </span>
      {active && (
        <span className="absolute left-0 w-0.5 h-5 bg-primary rounded-r" />
      )}
    </Button>
  )
}
