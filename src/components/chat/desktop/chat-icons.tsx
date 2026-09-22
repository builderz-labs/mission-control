export function IconPlus({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v6M5 8h6" strokeLinecap="round" />
    </svg>
  )
}

export function IconArtifacts({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5.5L8 3l5 2.5v5L8 13l-5-2.5v-5z" strokeLinejoin="round" />
      <path d="M8 8v5M3 5.5L8 8l5-2.5" strokeLinejoin="round" />
    </svg>
  )
}

export function IconClock({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5L10 11" strokeLinecap="round" />
    </svg>
  )
}

export function IconDispatch({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="2.5" width="8" height="11" rx="1" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2" strokeLinecap="round" />
    </svg>
  )
}

export function IconCustomize({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4h10M3 8h10M3 12h6" strokeLinecap="round" />
    </svg>
  )
}

export function IconChevron({ className = 'h-3 w-3 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconSearch({ className = 'h-3.5 w-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4" />
      <path d="M14 14l-3-3" strokeLinecap="round" />
    </svg>
  )
}

export function IconSliders({ className = 'h-3.5 w-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h10M5.5 3v4M3 11h10M10.5 9v4" strokeLinecap="round" />
    </svg>
  )
}

export function IconSparkle({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5l1.2 4.3L13.5 7 9.2 8.2 8 12.5 6.8 8.2 2.5 7l4.3-1.2L8 1.5z" />
    </svg>
  )
}

export function IconSend({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 8h8M8 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconFolder({ className = 'h-3.5 w-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11V4.5z" strokeLinejoin="round" />
    </svg>
  )
}

export function IconPin({ className = 'h-3.5 w-3.5 shrink-0', filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
      <path d="M8 14s4.5-4.2 4.5-7.2A4.5 4.5 0 0 0 8 2.3a4.5 4.5 0 0 0-4.5 4.5C3.5 9.8 8 14 8 14z" strokeLinejoin="round" />
      {!filled && <circle cx="8" cy="6.8" r="1.2" />}
    </svg>
  )
}

export function IconGrip({ className = 'h-3.5 w-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="6" cy="4" r="1" />
      <circle cx="10" cy="4" r="1" />
      <circle cx="6" cy="8" r="1" />
      <circle cx="10" cy="8" r="1" />
      <circle cx="6" cy="12" r="1" />
      <circle cx="10" cy="12" r="1" />
    </svg>
  )
}

export function IconClose({ className = 'h-3.5 w-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

export function IconCheck({ className = 'h-3.5 w-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
