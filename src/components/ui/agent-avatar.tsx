'use client'

import Image from 'next/image'

const AVATAR_MAP: Record<string, { sm: string; lg: string }> = {
  userboy: { sm: '/avatars/cseno.png', lg: '/avatars/cseno_big.png' },
  cseno: { sm: '/avatars/cseno.png', lg: '/avatars/cseno_big.png' },
  main: { sm: '/avatars/cseno.png', lg: '/avatars/cseno_big.png' },
  cody: { sm: '/avatars/cody.png', lg: '/avatars/cody_big.png' },
  bookworm: { sm: '/avatars/bookworm.png', lg: '/avatars/bookworm_big.png' },
  cri: { sm: '/avatars/cri.png', lg: '/avatars/cri.png' },
}

const DISPLAY_NAMES: Record<string, string> = {
  userboy: 'UserBoy',
  cseno: 'Cseno',
  main: 'UserBoy',
  cody: 'Cody',
  bookworm: 'Bookworm',
  cri: 'Cri',
}

const SIZE_PX = { sm: 20, lg: 40 } as const

export function AgentAvatar({
  agent,
  size = 'sm',
  showLabel = false,
  className = '',
}: {
  agent: string
  size?: 'sm' | 'lg'
  showLabel?: boolean
  className?: string
}) {
  const name = agent.toLowerCase().trim()
  if (!name) return null

  const px = SIZE_PX[size]
  const avatarEntry = AVATAR_MAP[name]
  const displayName = DISPLAY_NAMES[name] || name.charAt(0).toUpperCase() + name.slice(1)

  const imgEl = avatarEntry ? (
    <Image
      src={size === 'lg' ? avatarEntry.lg : avatarEntry.sm}
      alt={displayName}
      width={px}
      height={px}
      className="rounded-[6px] object-cover ring-1 ring-border shrink-0"
      style={{ width: px, height: px }}
      unoptimized
    />
  ) : (
    <span
      className="inline-flex items-center justify-center rounded-[6px] bg-zinc-700 text-zinc-300 ring-1 ring-border shrink-0 font-medium"
      style={{ width: px, height: px, fontSize: px * 0.45 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )

  if (!showLabel) return <span className={`inline-flex shrink-0 ${className}`}>{imgEl}</span>

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {imgEl}
      <span className={size === 'sm' ? 'text-xs text-zinc-400' : 'text-sm text-foreground font-medium'}>
        {displayName}
      </span>
    </span>
  )
}
