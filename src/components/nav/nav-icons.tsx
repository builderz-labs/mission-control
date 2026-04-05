// All SVG nav icons (16x16 viewbox, stroke-based)
// Extracted from nav-rail.tsx so the main file stays focused on layout/behavior

export function OverviewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  )
}

export function AgentsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  )
}

export function TasksIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

export function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M13 3H3a1 1 0 0 0-1 1v6l3-2h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
      <path d="M6 11v1a1 1 0 0 0 1 1h4l2 2v-4a1 1 0 0 0-1-1h-1" />
    </svg>
  )
}

export function SessionsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h12v9H2zM5 12v2M11 12v2M4 14h8" />
    </svg>
  )
}

export function ActivityIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,8 4,8 6,3 8,13 10,6 12,8 15,8" />
    </svg>
  )
}

export function LogsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

export function CronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4v4l2.5 2.5" />
    </svg>
  )
}

export function MemoryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="8" rx="6" ry="3" />
      <path d="M2 8v3c0 1.7 2.7 3 6 3s6-1.3 6-3V8" />
      <path d="M2 5v3c0 1.7 2.7 3 6 3s6-1.3 6-3V5" />
    </svg>
  )
}

export function TokensIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4v8M5.5 6h5a1.5 1.5 0 010 3H6" />
    </svg>
  )
}

export function UsersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" />
      <circle cx="11.5" cy="5.5" r="2" />
      <path d="M14.5 14c0-2 -1.5-3.5-3-3.5" />
    </svg>
  )
}

export function AuditIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1L2 4v4c0 4 2.5 6 6 7 3.5-1 6-3 6-7V4L8 1z" />
      <path d="M6 8l2 2 3-3" />
    </svg>
  )
}

export function WebhookIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="2.5" />
      <circle cx="11" cy="5" r="2.5" />
      <circle cx="8" cy="12" r="2.5" />
      <path d="M5 7.5v1c0 1.1.4 2 1.2 2.7" />
      <path d="M11 7.5v1c0 1.1-.4 2-1.2 2.7" />
    </svg>
  )
}

export function GatewayConfigIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="5.5" cy="8" r="1" />
      <circle cx="10.5" cy="8" r="1" />
      <path d="M6.5 8h3" />
    </svg>
  )
}

export function GatewaysIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="5" rx="1" />
      <rect x="1" y="9" width="14" height="5" rx="1" />
      <circle cx="4" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="4" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
      <path d="M7 4.5h5M7 11.5h5" />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13h4M3.5 10c0-1-1-2-1-4a5.5 5.5 0 0111 0c0 2-1 3-1 4H3.5z" />
      <path d="M8 1v1" />
    </svg>
  )
}

export function IntegrationsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 4h4M4 6v4M12 6v4M6 12h4" />
    </svg>
  )
}

export function AgentCostsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-2.8 2.2-5 5-5" />
      <circle cx="12" cy="10" r="3.5" />
      <path d="M12 8.5v3M10.8 10h2.4" />
    </svg>
  )
}

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 12.5c-3 1-3-1.5-4-2m8 4v-2.2a2.1 2.1 0 00-.6-1.6c2-.2 4.1-1 4.1-4.5a3.5 3.5 0 00-1-2.4 3.2 3.2 0 00-.1-2.4s-.8-.2-2.5 1a8.7 8.7 0 00-4.6 0C3.7 3.4 2.9 3.6 2.9 3.6a3.2 3.2 0 00-.1 2.4 3.5 3.5 0 00-1 2.4c0 3.5 2.1 4.3 4.1 4.5a2.1 2.1 0 00-.6 1.6v2.2" />
    </svg>
  )
}

export function SkillsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

export function SuperAdminIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1L2 4v4c0 4 2.5 6 6 7 3.5-1 6-3 6-7V4L8 1z" />
      <path d="M8 5v2M8 9v0.5" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4" />
    </svg>
  )
}

export function OfficeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="10" rx="1" />
      <path d="M2 7h12" />
      <path d="M5 1v3M11 1v3" />
      <rect x="4" y="9" width="3" height="3" rx="0.5" />
      <rect x="9" y="9" width="3" height="3" rx="0.5" />
    </svg>
  )
}

export function OrganizationsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="1" width="8" height="5" rx="1" />
      <rect x="1" y="10" width="5" height="5" rx="1" />
      <rect x="10" y="10" width="5" height="5" rx="1" />
      <path d="M8 6v2M4 10L8 8M12 10L8 8" />
    </svg>
  )
}

export function ChannelsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4h14M1 8h14M1 12h14" />
      <circle cx="4" cy="4" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function NodesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="5" height="5" rx="1" />
      <rect x="10" y="1" width="5" height="5" rx="1" />
      <rect x="5.5" y="10" width="5" height="5" rx="1" />
      <path d="M6 3.5h4M3.5 6v4.5L5.5 12M12.5 6v4.5L10.5 12" />
    </svg>
  )
}

export function ApprovalsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1v4M4.5 3l2 2M11.5 3l-2 2" />
      <rect x="2" y="6" width="12" height="9" rx="1.5" />
      <path d="M5.5 10.5l2 2 3.5-4" />
    </svg>
  )
}

export function DebugIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="9" r="5" />
      <path d="M8 4V1M3.5 6L1 4.5M12.5 6L15 4.5M3 9H1M15 9h-2M3.5 12L1 13.5M12.5 12L15 13.5" />
      <path d="M8 7v4M6 9h4" />
    </svg>
  )
}

export function SecurityIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1l6 3v4c0 3.5-2.5 6.5-6 7.5C4.5 14.5 2 11.5 2 8V4l6-3z" />
      <path d="M5.5 8l2 2 3.5-3.5" />
    </svg>
  )
}

export function JarvisIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
      <path d="M3.5 3.5l1.5 1.5M11 11l1.5 1.5M11 5l1.5-1.5M3.5 12.5L5 11" />
    </svg>
  )
}

export function PluginIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v3M10 2v3M4 5h8a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
      <circle cx="8" cy="10" r="1.5" />
    </svg>
  )
}

export function NotificationsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5a5 5 0 015 5v3l1.5 2H1.5L3 9.5v-3a5 5 0 015-5z" />
      <path d="M6.5 13.5a1.5 1.5 0 003 0" />
    </svg>
  )
}

export function StandupIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="1" width="10" height="14" rx="1.5" />
      <path d="M6 4h4M6 7h4M6 10h2" />
      <path d="M5 4l-.5-.5M5 7l-.5-.5M5 10l-.5-.5" />
    </svg>
  )
}

export function DocumentsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3.5A1.5 1.5 0 013.5 2H9l4 4v8.5A1.5 1.5 0 0111.5 16h-8A1.5 1.5 0 012 14.5v-11z" />
      <path d="M9 2v4h4" />
      <path d="M5 9h6M5 12h4" />
    </svg>
  )
}

export function PipelineIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="5.5" width="4" height="5" rx="1" />
      <rect x="6" y="5.5" width="4" height="5" rx="1" />
      <rect x="11" y="5.5" width="4" height="5" rx="1" />
      <path d="M5 8h1M10 8h1" />
    </svg>
  )
}

export function AgentHistoryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="2.5" />
      <path d="M2.5 14c0-2.5 2-4.5 5.5-4.5" />
      <circle cx="12" cy="11" r="3" />
      <path d="M12 9.5v1.5l1 1" />
    </svg>
  )
}

export function SessionDetailsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="12" rx="1.5" />
      <path d="M1 5h14" />
      <path d="M4 8.5l2 1.5-2 1.5" />
      <path d="M8 11h4" />
    </svg>
  )
}

export function PresentationsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="10" rx="1.5" />
      <path d="M5 14h6M8 12v2" />
      <path d="M4 6h8M4 9h5" />
    </svg>
  )
}

export function TokenDashboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="10" width="2.5" height="4" rx="0.5" />
      <rect x="6" y="7" width="2.5" height="7" rx="0.5" />
      <rect x="10" y="4" width="2.5" height="10" rx="0.5" />
      <path d="M2 8l4-3 4-2 4-1" />
    </svg>
  )
}

export function IntelBriefIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h3" />
      <circle cx="12" cy="12" r="3" fill="none" />
      <path d="M12 10.5v1.5l.8.8" />
    </svg>
  )
}

export function LeaderboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="9" width="4" height="6" rx="0.5" />
      <rect x="6" y="5" width="4" height="10" rx="0.5" />
      <rect x="11" y="7" width="4" height="8" rx="0.5" />
      <path d="M8 1l1.2 2.4L12 3.9l-2 1.95.47 2.75L8 7.25 5.53 8.6 6 5.85 4 3.9l2.8-.5z" />
    </svg>
  )
}
