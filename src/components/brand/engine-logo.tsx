'use client'

import Image from 'next/image'
import type { ReactNode } from 'react'
import { ENGINE_META, engineFromKind, inferEngineFromText, type EngineId } from '@/lib/chat-model-groups'

export function EngineLogo({
  engine,
  size = 16,
  className = '',
  decorative = false,
}: {
  engine: EngineId
  size?: number
  className?: string
  decorative?: boolean
}) {
  const meta = ENGINE_META[engine]
  return (
    <Image
      src={meta.logo}
      alt={decorative ? '' : `${meta.label} logo`}
      aria-hidden={decorative || undefined}
      width={size}
      height={size}
      unoptimized
      className={`shrink-0 rounded-[4px] object-cover ${className}`}
    />
  )
}

export function LlmLabel({
  text,
  children,
  size = 16,
  className = '',
  textClassName = '',
}: {
  text: string
  children?: ReactNode
  size?: number
  className?: string
  textClassName?: string
}) {
  const engine = inferEngineFromText(text)
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {engine && <EngineLogo engine={engine} size={size} decorative />}
      <span className={textClassName}>{children ?? text}</span>
    </span>
  )
}

export function EngineLogoForText({
  text,
  size = 16,
  className = '',
  decorative = false,
}: {
  text: string | undefined | null
  size?: number
  className?: string
  decorative?: boolean
}) {
  const engine = inferEngineFromText(text)
  if (!engine) return null
  return <EngineLogo engine={engine} size={size} className={className} decorative={decorative} />
}

export function EngineLogoSet({
  kinds,
  size = 14,
  decorative = false,
}: {
  kinds: Array<string | undefined>
  size?: number
  decorative?: boolean
}) {
  const engines = Array.from(new Set(kinds.map((kind) => engineFromKind(kind)).filter((engine): engine is EngineId => Boolean(engine))))
  if (engines.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {engines.map((engine) => (
        <EngineLogo key={engine} engine={engine} size={size} decorative={decorative} />
      ))}
    </span>
  )
}
