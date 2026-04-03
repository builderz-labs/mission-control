'use client'

import dynamic from 'next/dynamic'

const JarvisOrb = dynamic(
  () => import('@/components/voice/jarvis-orb').then(m => ({ default: m.JarvisOrb })),
  { ssr: false }
)

export function JarvisGlobal() {
  return <JarvisOrb />
}
