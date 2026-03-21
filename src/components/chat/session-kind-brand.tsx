'use client'

import Image from 'next/image'

type SessionKind = 'claude-code' | 'codex-cli' | 'gateway' | 'hermes'

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
    pillClassName: 'bg-[hsl(18_58%_42%_/0.14)] text-[hsl(18_58%_42%)] font-mono',
  },
  'codex-cli': {
    label: 'Codex CLI',
    shortLabel: 'CX',
    pillClassName: 'bg-[hsl(40_28%_60%_/0.18)] text-[hsl(28_18%_18%)] font-mono',
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
    pillClassName: 'bg-[hsl(120_20%_86%)] text-[hsl(28_18%_18%)] font-mono',
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
      className={`${sizeClassName} rounded-full bg-surface-2 flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0 font-mono`}
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
