'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LanguageSwitcherSelect } from '@/components/ui/language-switcher'

type SetupStep = 'form' | 'creating'

interface ProgressStep {
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
}

function getInitialProgress(t: (key: string) => string): ProgressStep[] {
  return [
    { label: t('validatingCredentials'), status: 'pending' },
    { label: t('creatingAdminAccount'), status: 'pending' },
    { label: t('configuringSession'), status: 'pending' },
    { label: t('launchingDashboard'), status: 'pending' },
  ]
}

function ProgressIndicator({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            {step.status === 'done' && (
              <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
            {step.status === 'active' && (
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            )}
            {step.status === 'pending' && (
              <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
            )}
            {step.status === 'error' && (
              <svg className="w-5 h-5 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          </div>
          <span className={`text-sm ${
            step.status === 'active' ? 'text-foreground font-medium' :
            step.status === 'done' ? 'text-green-400' :
            step.status === 'error' ? 'text-destructive' :
            'text-muted-foreground'
          }`}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function SetupPage() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [step, setStep] = useState<SetupStep>('form')
  const [progress, setProgress] = useState<ProgressStep[]>(() => getInitialProgress(t))
  const [checking, setChecking] = useState(true)
  const [setupAvailable, setSetupAvailable] = useState(false)

  useEffect(() => {
    fetch('/api/setup')
      .then((res) => res.json())
      .then((data) => {
        if (!data.needsSetup) {
          window.location.href = '/login'
          return
        }
        setSetupAvailable(true)
        setChecking(false)
      })
      .catch(() => {
        setError(t('failedToCheckSetup'))
        setChecking(false)
      })
  }, [t])

  const updateProgress = useCallback((index: number, status: ProgressStep['status']) => {
    setProgress((prev) => prev.map((s, i) => (i === index ? { ...s, status } : s)))
  }, [])

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'))
      return
    }
    if (password.length < 12) {
      setError(t('passwordTooShort'))
      return
    }

    setStep('creating')
    setProgress(getInitialProgress(t))

    // Step 1: Validating
    updateProgress(0, 'active')
    await new Promise((r) => setTimeout(r, 400))
    updateProgress(0, 'done')

    // Step 2: Creating account
    updateProgress(1, 'active')
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          displayName: displayName || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        updateProgress(1, 'error')
        setError(data?.error || t('setupFailed'))
        // Allow retry after a brief pause
        await new Promise((r) => setTimeout(r, 1500))
        setStep('form')
        setProgress(getInitialProgress(t))
        return
      }

      updateProgress(1, 'done')

      // Step 3: Configuring session
      updateProgress(2, 'active')
      await new Promise((r) => setTimeout(r, 500))
      updateProgress(2, 'done')

      // Step 4: Launching
      updateProgress(3, 'active')
      await new Promise((r) => setTimeout(r, 300))
      updateProgress(3, 'done')

      await new Promise((r) => setTimeout(r, 500))
      window.location.href = '/'
    } catch {
      updateProgress(1, 'error')
      setError(t('networkError'))
      await new Promise((r) => setTimeout(r, 1500))
      setStep('form')
      setProgress(getInitialProgress(t))
    }
  }, [username, password, confirmPassword, displayName, updateProgress, t])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
          {t('checkingSetupStatus')}
        </div>
      </div>
    )
  }

  if (!setupAvailable) {
    return null
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcherSelect />
      </div>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-lg overflow-hidden bg-background border border-border/50 flex items-center justify-center mb-3">
            <Image
              src="/brand/mc-logo-128.png"
              alt="Mission Control logo"
              width={48}
              height={48}
              className="h-full w-full object-cover"
              priority
            />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {step === 'form' ? t('welcomeToMC') : t('settingUpMC')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === 'form'
              ? t('createAdminToStart')
              : t('creatingAdmin')}
          </p>
        </div>

        {step === 'creating' && (
          <div className="mb-6 p-4 rounded-lg bg-secondary/50 border border-border">
            <ProgressIndicator steps={progress} />
            {error && (
              <div role="alert" className="mt-3 p-2 rounded bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        {step === 'form' && (
          <>
            {error && (
              <div role="alert" className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1.5">
                  {t('username')}
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
                  placeholder="admin"
                  autoComplete="username"
                  autoFocus
                  required
                  minLength={2}
                  maxLength={64}
                  pattern="[a-z0-9_.\-]+"
                  title={t('usernameHint')}
                />
              </div>

              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-foreground mb-1.5">
                  {t('displayName')} <span className="text-muted-foreground font-normal">({tc('optional')})</span>
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
                  placeholder="Admin"
                  maxLength={100}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                  {t('password')}
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
                  placeholder={t('atLeast12Chars')}
                  autoComplete="new-password"
                  required
                  minLength={12}
                />
                {password.length > 0 && password.length < 12 && (
                  <p className="mt-1 text-xs text-amber-400">
                    {t('moreCharsNeeded', { count: 12 - password.length })}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                  {t('confirmPassword')}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
                  placeholder={t('repeatPassword')}
                  autoComplete="new-password"
                  required
                  minLength={12}
                />
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <p className="mt-1 text-xs text-destructive">{t('passwordsDoNotMatch')}</p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full rounded-lg"
              >
                {t('createAdminAccount')}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground mt-6">
              {t('firstTimeSetupOnly')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
