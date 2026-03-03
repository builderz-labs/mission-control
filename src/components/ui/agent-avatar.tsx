'use client'

/**
 * AgentAvatar — reusable avatar component for agents.
 *
 * Displays an agent's custom icon, emoji, or auto-generated initials
 * with a deterministic background color derived from the agent name.
 * Includes an optional online/offline status ring.
 */

/* eslint-disable @next/next/no-img-element */

interface AgentAvatarProps {
  name: string
  iconUrl?: string | null
  iconColor?: string | null
  iconEmoji?: string | null
  status?: 'offline' | 'idle' | 'busy' | 'error' | string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showStatus?: boolean
  className?: string
}

const sizeMap = {
  xs: { container: 'w-5 h-5', text: 'text-[8px]', emoji: 'text-[10px]', ring: 'w-1.5 h-1.5 -bottom-px -right-px', img: 'w-5 h-5' },
  sm: { container: 'w-7 h-7', text: 'text-[10px]', emoji: 'text-xs', ring: 'w-2 h-2 bottom-0 right-0', img: 'w-7 h-7' },
  md: { container: 'w-9 h-9', text: 'text-xs', emoji: 'text-sm', ring: 'w-2.5 h-2.5 bottom-0 right-0', img: 'w-9 h-9' },
  lg: { container: 'w-14 h-14', text: 'text-base', emoji: 'text-xl', ring: 'w-3 h-3 bottom-0.5 right-0.5', img: 'w-14 h-14' },
}

const statusColors: Record<string, string> = {
  idle: 'bg-emerald-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
  offline: 'bg-gray-500',
}

// Deterministic color palette based on agent name hash
const avatarPalette = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
  'bg-orange-600', 'bg-pink-600', 'bg-lime-600', 'bg-fuchsia-600',
]

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function AgentAvatar({
  name,
  iconUrl,
  iconColor,
  iconEmoji,
  status,
  size = 'sm',
  showStatus = false,
  className = '',
}: AgentAvatarProps) {
  const s = sizeMap[size]
  const colorClass = iconColor || avatarPalette[hashName(name) % avatarPalette.length]

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className={`${s.container} rounded-full flex items-center justify-center font-semibold text-white overflow-hidden ${colorClass}`}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={name} className={`${s.img} object-cover`} />
        ) : iconEmoji ? (
          <span className={s.emoji}>{iconEmoji}</span>
        ) : (
          <span className={s.text}>{getInitials(name)}</span>
        )}
      </div>
      {showStatus && status && (
        <span
          className={`absolute ${s.ring} rounded-full border-2 border-card ${statusColors[status] || statusColors.offline}`}
        />
      )}
    </div>
  )
}
