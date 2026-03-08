'use client'

import { APP_VERSION } from '@/lib/version'

function OpenClawMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.06145 23.1079C5.26816 22.3769 -3.39077 20.6274 1.4173 5.06384C9.6344 6.09939 16.9728 14.0644 9.06145 23.1079Z" fill="url(#oc0)" />
      <path d="M8.91928 23.0939C5.27642 21.2223 0.78371 4.20891 17.0071 0C20.7569 7.19341 19.6212 16.5452 8.91928 23.0939Z" fill="url(#oc1)" />
      <path d="M8.91388 23.0788C8.73534 19.8817 10.1585 9.08525 23.5699 13.1107C23.1812 20.1229 18.984 26.4182 8.91388 23.0788Z" fill="url(#oc2)" />
      <defs>
        <linearGradient id="oc0" x1="3.776" y1="5.916" x2="5.232" y2="21.559" gradientUnits="userSpaceOnUse">
          <stop stopColor="#18E299" /><stop offset="1" stopColor="#15803D" />
        </linearGradient>
        <linearGradient id="oc1" x1="12.171" y1="-0.718" x2="10.190" y2="22.983" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16A34A" /><stop offset="1" stopColor="#4ADE80" />
        </linearGradient>
        <linearGradient id="oc2" x1="23.133" y1="15.353" x2="9.338" y2="18.520" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4ADE80" /><stop offset="1" stopColor="#0D9373" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function MissionControlMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Central node */}
      <circle cx="24" cy="24" r="4" fill="currentColor" fillOpacity="0.9" />
      <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="1" strokeOpacity="0.3" />
      {/* Satellite nodes */}
      <circle cx="24" cy="8" r="2.5" fill="currentColor" fillOpacity="0.7" />
      <circle cx="38" cy="16" r="2.5" fill="currentColor" fillOpacity="0.7" />
      <circle cx="38" cy="32" r="2.5" fill="currentColor" fillOpacity="0.7" />
      <circle cx="24" cy="40" r="2.5" fill="currentColor" fillOpacity="0.7" />
      <circle cx="10" cy="32" r="2.5" fill="currentColor" fillOpacity="0.7" />
      <circle cx="10" cy="16" r="2.5" fill="currentColor" fillOpacity="0.7" />
      {/* Spokes */}
      <line x1="24" y1="18" x2="24" y2="10.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="29" y1="20" x2="35.5" y2="16" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="29" y1="28" x2="35.5" y2="32" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="24" y1="30" x2="24" y2="37.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="19" y1="28" x2="12.5" y2="32" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="19" y1="20" x2="12.5" y2="16" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
      {/* Outer ring segments */}
      <line x1="26" y1="8" x2="36" y2="15" stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.2" />
      <line x1="38" y1="18.5" x2="38" y2="29.5" stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.2" />
      <line x1="36" y1="33" x2="26" y2="40" stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.2" />
      <line x1="22" y1="40" x2="12" y2="33" stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.2" />
      <line x1="10" y1="29.5" x2="10" y2="18.5" stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.2" />
      <line x1="12" y1="15" x2="22" y2="8" stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.2" />
    </svg>
  )
}

function ClaudeMark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Vertical spoke */}
      <line x1="24" y1="8" x2="24" y2="40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* 60-degree spoke */}
      <line x1="10.14" y1="32" x2="37.86" y2="16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* 120-degree spoke */}
      <line x1="10.14" y1="16" x2="37.86" y2="32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

interface InitStep {
  key: string
  label: string
  status: 'pending' | 'done'
}

interface LoaderProps {
  variant?: 'page' | 'panel' | 'inline'
  label?: string
  steps?: InitStep[]
}

function LoaderDots({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dotSize = size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '0ms' }} />
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '200ms' }} />
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '400ms' }} />
    </div>
  )
}

function StepIcon({ status, isActive }: { status: 'pending' | 'done'; isActive: boolean }) {
  if (status === 'done') {
    return (
      <svg className="w-3.5 h-3.5 text-primary check-enter" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8.5l3.5 3.5 6.5-7" />
      </svg>
    )
  }
  if (isActive) {
    return <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
  }
  return <div className="w-2 h-2 rounded-full bg-border" />
}

function PageLoader({ steps }: { steps?: InitStep[] }) {
  const doneCount = steps?.filter(s => s.status === 'done').length ?? 0
  const totalCount = steps?.length ?? 1
  const progress = steps ? (doneCount / totalCount) * 100 : 0
  const allDone = steps ? doneCount === totalCount : false

  // Find the first pending step (the "active" one)
  const activeIndex = steps?.findIndex(s => s.status === 'pending') ?? -1

  return (
    <div
      className={`flex items-center justify-center min-h-screen bg-background void-bg transition-opacity duration-300 ${allDone ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex flex-col items-center gap-8 w-64">
        {/* Animated logo sequence: OpenClaw + Claude converge → morph into MC mark */}
        <div className="relative flex items-center justify-center h-16 w-full">
          {/* Ambient glow */}
          <div
            className="absolute w-28 h-28 rounded-full bg-primary/8 blur-2xl animate-glow-pulse"
            style={{ animationDelay: '2.2s' }}
          />
          {/* Phase 1: Converging pair (fades out at 1.8s) */}
          <div className="absolute inset-0 flex items-center justify-center animate-pair-fade-out">
            <div className="flex items-center gap-3">
              <div className="opacity-0 animate-converge-left">
                <OpenClawMark className="w-10 h-10" />
              </div>
              <div className="w-1 h-1 rounded-full bg-primary opacity-0 animate-converge-burst" />
              <div className="opacity-0 animate-converge-right">
                <ClaudeMark className="w-10 h-10" style={{ color: 'hsl(25, 95%, 53%)' }} />
              </div>
            </div>
          </div>
          {/* Phase 2: MC mark emerges (fades in at 2.0s) */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 animate-mc-fade-in">
            <div className="animate-float" style={{ animationDelay: '2.7s' }}>
              <MissionControlMark className="w-14 h-14 text-primary" />
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-1">
          <h1 className="font-mono text-sm tracking-[0.2em] uppercase text-foreground font-medium">
            Mission Control
          </h1>
          <p className="text-2xs text-muted-foreground/60">
            Agent Orchestration
          </p>
        </div>

        {/* Progress section — appears after logo animation, only while loading */}
        {steps ? (
          <div
            className="w-full flex flex-col items-center gap-4 opacity-0 animate-mc-fade-in"
          >
            {/* Progress bar */}
            <div className="w-full h-0.5 bg-border/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary shimmer-bar rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Step list */}
            <div className="w-full space-y-2">
              {steps.map((step, i) => (
                <div
                  key={step.key}
                  className={`flex items-center gap-2.5 text-xs transition-all duration-300 ${
                    step.status === 'done'
                      ? 'text-muted-foreground/50 h-0 overflow-hidden opacity-0'
                      : i === activeIndex
                        ? 'text-foreground'
                        : 'text-muted-foreground/40'
                  }`}
                >
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    <StepIcon status={step.status} isActive={i === activeIndex} />
                  </div>
                  <span className="font-mono text-2xs tracking-wide">{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* SSR fallback — no progress data yet */
          <LoaderDots />
        )}

        {/* Version */}
        <span className="text-2xs font-mono text-muted-foreground/40">
          v{APP_VERSION}
        </span>
      </div>
    </div>
  )
}

export function Loader({ variant = 'panel', label, steps }: LoaderProps) {
  if (variant === 'page') {
    return <PageLoader steps={steps} />
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2">
        <LoaderDots size="sm" />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    )
  }

  // panel (default)
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3">
        <LoaderDots />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    </div>
  )
}
