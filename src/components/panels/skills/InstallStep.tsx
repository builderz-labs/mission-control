'use client'

interface InstallStepProps {
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
}

export function InstallStep({ label, status }: InstallStepProps) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-5 h-5 flex items-center justify-center shrink-0">
        {status === 'pending' && (
          <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
        )}
        {status === 'active' && (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        )}
        {status === 'done' && (
          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        )}
        {status === 'error' && (
          <svg className="w-4 h-4 text-destructive" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" />
          </svg>
        )}
      </div>
      <span className={`text-xs ${
        status === 'active' ? 'text-foreground font-medium'
          : status === 'done' ? 'text-muted-foreground'
          : status === 'error' ? 'text-destructive'
          : 'text-muted-foreground/50'
      }`}>
        {label}
      </span>
    </div>
  )
}
