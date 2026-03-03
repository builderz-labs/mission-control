'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

export function panelHref(panel: string): string {
  return panel === 'overview' ? '/' : `/${panel}`
}

export function useNavigateToPanel() {
  const router = useRouter()
  return useCallback((panel: string) => {
    router.push(panelHref(panel))
  }, [router])
}
