'use client'

interface AgentAvatarProps {
  name: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
  iconUrl?: string | null
  iconColor?: string | null
  iconEmoji?: string | null
  status?: 'offline' | 'idle' | 'busy' | 'error'
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function getAvatarColors(name: string, iconColor?: string | null): { backgroundColor: string; color: string } {
  if (iconColor) {
    return { backgroundColor: iconColor, color: 'hsl(0 0% 98%)' }
  }
  const hash = hashString(name.toLowerCase())
  const hue = hash % 360
  return {
    backgroundColor: `hsl(${hue} 70% 38%)`,
    color: 'hsl(0 0% 98%)',
  }
}

const sizeClasses: Record<NonNullable<AgentAvatarProps['size']>, string> = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
}

const emojiSizes: Record<NonNullable<AgentAvatarProps['size']>, string> = {
  xs: 'text-[10px]',
  sm: 'text-xs',
  md: 'text-sm',
}

const statusRingColors: Record<string, string> = {
  idle: 'ring-green-500',
  busy: 'ring-yellow-500',
  error: 'ring-red-500',
  offline: 'ring-gray-500',
}

export function AgentAvatar({ name, size = 'sm', className = '', iconUrl, iconColor, iconEmoji, status }: AgentAvatarProps) {
  const initials = getInitials(name)
  const colors = getAvatarColors(name, iconColor)
  const statusRing = status ? `ring-1 ring-offset-1 ring-offset-card ${statusRingColors[status] || ''}` : ''

  // Custom image avatar
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={name}
        title={name}
        className={`rounded-full object-cover shrink-0 ${sizeClasses[size]} ${statusRing} ${className}`}
      />
    )
  }

  // Emoji avatar
  if (iconEmoji) {
    return (
      <div
        className={`rounded-full flex items-center justify-center shrink-0 ${sizeClasses[size]} ${emojiSizes[size]} ${statusRing} ${className}`}
        style={colors}
        title={name}
        aria-label={name}
      >
        {iconEmoji}
      </div>
    )
  }

  // Default initials avatar
  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold shrink-0 ${sizeClasses[size]} ${statusRing} ${className}`}
      style={colors}
      title={name}
      aria-label={name}
    >
      {initials}
    </div>
  )
}

