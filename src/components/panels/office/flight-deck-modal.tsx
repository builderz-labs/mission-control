'use client'

// Flight Deck install prompt — shown when the local companion app is not detected.

import { Button } from '@/components/ui/button'

interface FlightDeckModalProps {
  flightDeckDownloadUrl: string
  onClose: () => void
}

export function FlightDeckModal({ flightDeckDownloadUrl, onClose }: FlightDeckModalProps): React.ReactElement {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Flight Deck Required</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Flight Deck is the private/pro companion app for Ultron.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl w-6 h-6"
          >
            ×
          </Button>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
          It looks like Flight Deck is not installed on this machine.
          Install it to open agent sessions with richer controls and diagnostics.
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Maybe Later
          </Button>
          <a
            href={flightDeckDownloadUrl}
            target="_blank"
            rel="noreferrer"
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-smooth inline-flex items-center"
          >
            Download Flight Deck
          </a>
        </div>
      </div>
    </div>
  )
}
