/**
 * Lionroot nav group for Mission Control NavRail.
 * Imported by patched nav-rail.tsx (see UPSTREAM-PATCHES.md).
 */

function BriefingRoomIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 5h6M5 8h4M5 11h5" />
    </svg>
  )
}

function GuidanceIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2h5v6H2zM9 2h5v4H9zM9 8h5v6H9zM2 10h5v4H2z" />
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
    { id: 'briefing-room', label: 'Briefing Room', icon: <BriefingRoomIcon />, priority: true },
    { id: 'guidance', label: 'Guidance', icon: <GuidanceIcon />, priority: true },
    { id: 'usage-ledger', label: 'Usage', icon: <UsageIcon />, priority: false },
  ],
}
