'use client'

import Image from 'next/image'

type SessionKind = 'claude-code' | 'codex-cli' | 'hermes' | 'gateway'

const SESSION_KIND_META: Record<SessionKind, {
  label: string
  shortLabel: string
  pillClassName: string
  imageSrc?: string
  imageAlt?: string
}> = {
  'claude-code': {
    label: 'Claude Code',
    shortLabel: 'CC',
    pillClassName: 'bg-primary/15 text-primary/80',
  },
  'codex-cli': {
    label: 'Codex CLI',
    shortLabel: 'CX',
    pillClassName: 'bg-amber-500/15 text-amber-400/80',
    imageSrc: '/brand/codex-logo.png',
    imageAlt: 'Codex logo',
  },
  hermes: {
    label: 'Hermes Agent',
    shortLabel: 'HM',
    pillClassName: 'bg-cyan-500/15 text-cyan-300/80',
    imageSrc: '/brand/hermes-logo.png',
    imageAlt: 'Hermes logo',
  },
  gateway: {
    label: 'Gateway',
    shortLabel: 'GW',
    pillClassName: 'bg-muted text-muted-foreground',
  },
}

function getMeta(kind: string) {
  return SESSION_KIND_META[(kind in SESSION_KIND_META ? kind : 'gateway') as SessionKind]
}

export function getSessionKindLabel(kind: string): string {
  return getMeta(kind).label
}

export function SessionKindAvatar({
  kind,
  fallback,
  sizeClassName = 'w-7 h-7',
}: {
  kind: string
  fallback: string
  sizeClassName?: string
}) {
  const meta = getMeta(kind)

  if (meta.imageSrc) {
    return (
      <div
        className={`${sizeClassName} relative overflow-hidden rounded-full border border-border/50 bg-surface-2 shrink-0`}
        title={meta.label}
        aria-label={meta.label}
      >
        <Image
          src={meta.imageSrc}
          alt={meta.imageAlt || meta.label}
          fill
          sizes="28px"
          className="object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={`${sizeClassName} rounded-full bg-surface-2 flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0`}
      title={meta.label}
      aria-label={meta.label}
    >
      {fallback}
    </div>
  )
}

export function SessionKindPill({ kind }: { kind: string }) {
  const meta = getMeta(kind)

  return (
    <span className={`rounded px-1 py-px text-[9px] font-medium ${meta.pillClassName}`}>
      {meta.shortLabel}
    </span>
  )
}
