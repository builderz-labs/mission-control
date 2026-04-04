'use client'

import { IconFilm } from './marketing-icons'

const VIDEO_STYLES = [
  { label: 'Explainer', desc: 'Product walkthroughs & demos', icon: '🎬' },
  { label: 'Presentation', desc: 'Keynote-style recordings', icon: '🎤' },
  { label: 'Social', desc: 'Short-form viral content', icon: '📲' },
  { label: 'Ad Spot', desc: 'Paid advertising cuts', icon: '📡' },
]

export function MarketingVideoTab() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-col items-center py-16 text-center">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-muted/40 flex items-center justify-center mb-5 border border-border">
          <IconFilm className="text-muted-foreground w-9 h-9" />
        </div>

        <h3 className="text-xl font-semibold text-foreground mb-2">Video Generation</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Generate professional marketing videos with AI-powered Remotion rendering.
          Configure your video pipeline in Settings to get started.
        </p>

        {/* Style cards */}
        <div className="grid grid-cols-2 gap-3 mt-10 w-full max-w-lg">
          {VIDEO_STYLES.map(style => (
            <div
              key={style.label}
              className="p-4 rounded-xl border border-border bg-card/50 text-left opacity-60"
            >
              <div className="text-2xl mb-2">{style.icon}</div>
              <div className="text-sm font-medium text-foreground">{style.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{style.desc}</div>
            </div>
          ))}
        </div>

        {/* Setup info */}
        <div className="mt-8 p-4 rounded-xl border border-border bg-surface-1/50 max-w-sm w-full text-left">
          <p className="text-xs font-semibold text-foreground mb-2">Setup Required</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
              Install Remotion CLI
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
              Configure FFmpeg path in Settings
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
              Add <code className="px-1 py-0.5 rounded bg-muted">REMOTION_SERVE_URL</code> to .env
            </li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground mt-6 opacity-60">
          Coming soon — requires Remotion and FFmpeg setup
        </p>
      </div>
    </div>
  )
}
