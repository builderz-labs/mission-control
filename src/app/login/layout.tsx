import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Login | Mission Control',
  description: 'Sign in to Mission Control',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
