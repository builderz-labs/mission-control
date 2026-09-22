'use client'

import { Button } from '@/components/ui/button'
import { useFocusTrap } from '@/lib/use-focus-trap'

/** Optional setup must never turn the authenticated app into an empty, locked screen. */
export function OnboardingLoadFallback({ failed, onRetry, onContinue }: {
  failed: boolean
  onRetry: () => void
  onContinue: () => void
}) {
  const ref = useFocusTrap(onContinue)
  return (
    <div className="fixed inset-0 z-140 flex items-center justify-center bg-black/70 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="onboarding-load-title"
        aria-describedby="onboarding-load-help" className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-6 shadow-xl">
        <h2 id="onboarding-load-title" className="text-lg font-semibold text-foreground">
          {failed ? 'Setup could not load' : 'Loading your setup…'}
        </h2>
        <p id="onboarding-load-help" role={failed ? 'alert' : 'status'} className="text-sm text-muted-foreground">
          {failed ? 'The server is taking longer than expected. You can retry or continue to your workspace.' : 'You can continue to your workspace while optional setup is unavailable.'}
          {' '}Your setup progress will not be marked complete.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {failed && <Button variant="outline" onClick={onRetry}>Retry setup</Button>}
          <Button onClick={onContinue}>Continue to Mission Control</Button>
        </div>
      </div>
    </div>
  )
}
