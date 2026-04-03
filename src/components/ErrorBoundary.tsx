'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createClientLogger } from '@/lib/client-logger'
import { Button } from '@/components/ui/button'

const log = createClientLogger('ErrorBoundary')

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

// ADR: No useTranslations here — ErrorFallback is a last-resort boundary that renders when
// the component tree (including any NextIntlClientProvider) has already crashed. Depending
// on next-intl would cause a second crash on top of the first one. Hardcoded English is
// the correct approach for error boundaries; they must have zero runtime dependencies.
function ErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        {error?.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <Button onClick={onRetry} className="rounded-lg">
        Try again
      </Button>
    </div>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    log.error('Panel error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      )
    }

    return this.props.children
  }
}
