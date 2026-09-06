'use client'

import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'

export function UnknownPanel({ panel }: { panel: string }) {
  const navigateToPanel = useNavigateToPanel()

  return (
    <section className="flex min-h-[60vh] items-center justify-center p-6" aria-labelledby="unknown-panel-title">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-lg font-semibold text-muted-foreground" aria-hidden="true">
          ?
        </div>
        <h1 id="unknown-panel-title" className="text-xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Mission Control does not have a <span className="font-mono text-foreground">/{panel}</span> page.
        </p>
        <Button className="mt-6" onClick={() => navigateToPanel('overview')}>
          Go to Overview
        </Button>
      </div>
    </section>
  )
}

