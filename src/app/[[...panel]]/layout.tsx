import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mission Control',
  description: 'AI Agent orchestration and monitoring dashboard',
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
