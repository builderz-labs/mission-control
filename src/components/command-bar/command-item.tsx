'use client'

import type { Command } from './command-registry'

interface CommandItemProps {
  readonly command: Command
  readonly isSelected: boolean
  readonly onClick: () => void
  readonly index: number
}

const TYPE_BADGE: Record<string, string> = {
  panel:  'bg-primary/20 text-primary border border-primary/30',
  agent:  'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  action: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
}

const TYPE_LABEL: Record<string, string> = {
  panel:  'Panel',
  agent:  'Agent',
  action: 'Action',
}

/**
 * Single result row in the command bar.
 * Highlights the selected state with a subtle background.
 */
export function CommandItem({ command, isSelected, onClick, index }: CommandItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-command-index={index}
      className={`
        w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-75
        ${isSelected
          ? 'bg-primary/10 border-l-2 border-primary'
          : 'bg-transparent border-l-2 border-transparent hover:bg-white/[0.04]'
        }
      `}
      aria-selected={isSelected}
      role="option"
    >
      {/* Emoji icon */}
      <span className="text-base w-6 text-center shrink-0" aria-hidden="true">
        {command.icon ?? '▸'}
      </span>

      {/* Label + description */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{command.label}</div>
        {command.description && (
          <div className="text-xs text-muted-foreground truncate">{command.description}</div>
        )}
      </div>

      {/* Type badge */}
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGE[command.type] ?? ''}`}>
        {TYPE_LABEL[command.type] ?? command.type}
      </span>

      {/* Enter hint on selected */}
      {isSelected && (
        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-muted-foreground shrink-0">
          ↵
        </kbd>
      )}
    </button>
  )
}
