'use client'

interface ProfilesSettingsProps {
  hookProfile: string
  hookProfileSaving: boolean
  onSelectProfile: (value: 'minimal' | 'standard' | 'strict') => void
}

const PROFILES = [
  {
    value: 'minimal' as const,
    label: 'Minimal',
    desc: 'Basic safety checks only. Best for trusted environments with low risk tolerance overhead.',
  },
  {
    value: 'standard' as const,
    label: 'Standard',
    desc: 'Balanced scanning for secrets, injections, and suspicious patterns. Recommended for most deployments.',
  },
  {
    value: 'strict' as const,
    label: 'Strict',
    desc: 'Full depth scanning with aggressive blocking. May increase latency. Best for sensitive or compliance-driven environments.',
  },
]

export function ProfilesSettings({ hookProfile, hookProfileSaving, onSelectProfile }: ProfilesSettingsProps) {
  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-foreground mb-1">Hook Profile</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Controls how aggressively security hooks scan tool calls and agent outputs.
        </p>
        <div className="space-y-2">
          {PROFILES.map(profile => (
            <button
              key={profile.value}
              onClick={() => onSelectProfile(profile.value)}
              disabled={hookProfileSaving}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                hookProfile === profile.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30 bg-secondary'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                  hookProfile === profile.value ? 'border-primary' : 'border-muted-foreground/50'
                }`}>
                  {hookProfile === profile.value && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </div>
                <span className="text-sm font-medium text-foreground">{profile.label}</span>
              </div>
              <p className="text-xs text-muted-foreground ml-5">{profile.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
