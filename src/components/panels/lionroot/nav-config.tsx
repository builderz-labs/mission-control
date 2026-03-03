/**
 * Lionroot nav group for Mission Control NavRail.
 * Imported by patched nav-rail.tsx (see UPSTREAM-PATCHES.md).
 */

function GuidanceIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2h5v6H2zM9 2h5v4H9zM9 8h5v6H9zM2 10h5v4H2z" />
    </svg>
  )
}

function LoopsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4H6a3 3 0 000 6h4a3 3 0 010 6H4" />
      <polyline points="10,2 12,4 10,6" />
      <polyline points="6,10 4,12 6,14" />
    </svg>
  )
}

function ObservatoryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
    </svg>
  )
}

function NightshiftIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 8.5a5.5 5.5 0 01-7.5 5.1A6 6 0 018.5 2a5.5 5.5 0 005 6.5z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 7h12M5 1v4M11 1v4" />
    </svg>
  )
}

function UsageIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 14V8M5.5 14V5M9 14V7M12.5 14V3" />
    </svg>
  )
}

export const lionrootNavGroup = {
  id: 'lionroot',
  label: 'LIONROOT',
  items: [
    { id: 'guidance', label: 'Guidance', icon: <GuidanceIcon />, priority: false },
    { id: 'loops', label: 'Loops', icon: <LoopsIcon />, priority: false },
    { id: 'observatory', label: 'Observatory', icon: <ObservatoryIcon />, priority: false },
    { id: 'nightshift', label: 'Nightshift', icon: <NightshiftIcon />, priority: false },
    { id: 'lr-calendar', label: 'Calendar', icon: <CalendarIcon />, priority: false },
    { id: 'usage-ledger', label: 'Usage', icon: <UsageIcon />, priority: false },
  ],
}
