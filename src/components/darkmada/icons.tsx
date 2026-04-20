/**
 * DarkMada surface icons — inline SVGs, no icon library.
 * Sized 20x20 by default, inherits currentColor.
 */

type IconProps = { className?: string; size?: number }

function Svg({ children, className, size }: IconProps & { children: React.ReactNode }) {
  // If no size specified, fill the parent container (for nav contexts).
  const dim = size ? { width: size, height: size } : { width: '100%', height: '100%' }
  return (
    <svg
      viewBox="0 0 24 24"
      {...dim}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  )
}

export const OfficeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h2M13 10h2M9 14h2M13 14h2M9 18h6" />
  </Svg>
)

export const DeckIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v3M12 18v3M21 12h-3M6 12H3" />
    <path d="M12 12l5-4" strokeLinecap="round" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </Svg>
)

export const OrgIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="4" r="2" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="12" cy="19" r="2" />
    <circle cx="19" cy="19" r="2" />
    <path d="M12 6v6M5 17v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2M12 13v4" />
  </Svg>
)

export const AssemblyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="4" height="4" rx="1" />
    <rect x="10" y="6" width="4" height="4" rx="1" />
    <rect x="17" y="6" width="4" height="4" rx="1" />
    <rect x="3" y="14" width="4" height="4" rx="1" />
    <rect x="10" y="14" width="4" height="4" rx="1" />
    <rect x="17" y="14" width="4" height="4" rx="1" />
    <path d="M7 8h3M14 8h3M7 16h3M14 16h3" />
  </Svg>
)

export const VaultIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 10v2l1.5 1" />
    <path d="M7 8h.01M17 8h.01" />
  </Svg>
)

export const LibraryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4h5v16H4zM10 4h5v16h-5zM16 6l4 1v13l-4-1z" />
  </Svg>
)

export const WorkshopIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3l7 7-4 4-7-7 4-4zM9 9l-6 6 4 4 6-6M13 15l4 4" />
  </Svg>
)

export const ForgeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2l2.5 5 5.5.8-4 4 1 5.7L12 14.8 7 17.5l1-5.7-4-4 5.5-.8z" />
  </Svg>
)

export const IntelIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4M8 11h6M11 8v6" />
  </Svg>
)

export const ApprovalsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7l3 3 5-5M4 14l3 3 9-9M14 17h6" />
  </Svg>
)

export const AtlasIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.8 3 4 6 4 9s-1.2 6-4 9M12 3c-2.8 3-4 6-4 9s1.2 6 4 9" />
  </Svg>
)

export const SurfaceIconMap = {
  'dm-office': OfficeIcon,
  'dm-deck': DeckIcon,
  'dm-org': OrgIcon,
  'dm-assembly': AssemblyIcon,
  'dm-vault': VaultIcon,
  'dm-library': LibraryIcon,
  'dm-workshop': WorkshopIcon,
  'dm-forge': ForgeIcon,
  'dm-intel': IntelIcon,
} as const
