'use client'

import { IconFolder } from '../desktop/chat-icons'

export function ComposerChips({
  environment,
  project,
  folder,
}: {
  environment: string
  project: string
  folder: string
}) {
  const chips = [environment, project, folder].filter(Boolean)
  if (chips.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--chat-border)] bg-[var(--chat-elevated)] px-2.5 text-[12px] text-[var(--chat-text)]"
        >
          {chip === folder ? <IconFolder /> : null}
          {chip}
        </span>
      ))}
    </div>
  )
}
