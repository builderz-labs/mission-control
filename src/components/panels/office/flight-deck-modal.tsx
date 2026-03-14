'use client'

import type { LaunchToast } from './types'

interface FlightDeckModalProps {
  showFlightDeckModal: boolean
  setShowFlightDeckModal: (show: boolean) => void
  flightDeckDownloadUrl: string
}

export function FlightDeckModal({
  showFlightDeckModal,
  setShowFlightDeckModal,
  flightDeckDownloadUrl,
}: FlightDeckModalProps) {
  if (!showFlightDeckModal) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setShowFlightDeckModal(false)}>
      <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Flight Deck Required</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Flight Deck is the private/pro companion app for Mission Control.
            </p>
          </div>
          <button
            onClick={() => setShowFlightDeckModal(false)}
            className="text-muted-foreground hover:text-foreground text-xl"
          >
            ×
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
          It looks like Flight Deck is not installed on this machine.
          Install it to open agent sessions with richer controls and diagnostics.
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={() => setShowFlightDeckModal(false)}
            className="h-9 px-3 rounded-md border border-border text-sm text-foreground hover:bg-secondary/60 transition-smooth"
          >
            Maybe Later
          </button>
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

interface LaunchToastNotificationProps {
  launchToast: LaunchToast
}

export function LaunchToastNotification({ launchToast }: LaunchToastNotificationProps) {
  return (
    <div className="fixed right-4 bottom-4 z-[70] max-w-sm rounded-lg border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-2xl">
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${
            launchToast.kind === 'success'
              ? 'bg-green-400'
              : launchToast.kind === 'info'
                ? 'bg-blue-400'
                : 'bg-red-400'
          }`}
        />
        <div>
          <div className="text-sm font-semibold text-foreground">{launchToast.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{launchToast.detail}</div>
        </div>
      </div>
    </div>
  )
}
