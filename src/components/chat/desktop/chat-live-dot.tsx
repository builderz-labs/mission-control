export function ChatLiveDot({ live, label }: { live: boolean; label: string }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
        live
          ? 'bg-[var(--chat-success)] shadow-[0_0_6px_color-mix(in_srgb,var(--chat-success)_70%,transparent)] pulse-dot'
          : 'bg-[var(--chat-muted)]/40'
      }`}
      role="status"
      aria-label={label}
    />
  )
}
