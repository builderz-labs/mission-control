'use client'

import { APP_VERSION } from '@/lib/version'

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
        {/* Logo with glow halos */}
        <div className="relative flex items-center justify-center">
          {/* Outer glow halo */}
          <div
            className="absolute w-28 h-28 rounded-full bg-primary/8 blur-2xl animate-glow-pulse"
            style={{ animationDelay: '0s' }}
          />
          {/* Inner glow halo */}
          <div
            className="absolute w-20 h-20 rounded-full bg-primary/12 blur-xl animate-glow-pulse"
            style={{ animationDelay: '1.5s' }}
          />
          {/* Logo container */}
          <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-surface-1 border border-border/50 shadow-lg shadow-primary/5 void-border-glow animate-float">
            <img
              src="/brand/mc-logo-256.png"
              alt="Mission Control logo"
              className="w-full h-full object-cover"
            />
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

        {/* Progress section */}
        {steps ? (
          <div className="w-full flex flex-col items-center gap-4">
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
                  className={`flex items-center gap-2.5 text-xs transition-opacity duration-200 ${
                    step.status === 'done'
                      ? 'text-muted-foreground/70'
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
