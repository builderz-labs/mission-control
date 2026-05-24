import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Setup | Mission Control',
  description: 'Initial setup for Mission Control',
}

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
