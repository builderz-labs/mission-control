import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'API Reference | Mission Control',
  description: 'Interactive API documentation for Mission Control',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
