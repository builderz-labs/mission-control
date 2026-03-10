import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { nextIncompleteStepIndex, parseCompletedSteps, shouldShowOnboarding, markStepCompleted } from '@/lib/onboarding-state'

const ONBOARDING_STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'interface-mode', title: 'Interface' },
  { id: 'gateway-link', title: 'Gateway' },
  { id: 'credentials', title: 'Credentials' },
] as const

function getOnboardingSetting(key: string): string {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? ''
  } catch {
    return ''
  }
}

function setOnboardingSetting(key: string, value: string, actor: string) {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, 'onboarding', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `).run(key, value, `Onboarding: ${key}`, actor)
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const completed = getOnboardingSetting('onboarding.completed') === 'true'
    const skipped = getOnboardingSetting('onboarding.skipped') === 'true'
    const completedStepsRaw = getOnboardingSetting('onboarding.completed_steps')
    const completedSteps = parseCompletedSteps(completedStepsRaw, ONBOARDING_STEPS)

    const isAdmin = auth.user.role === 'admin'
    const showOnboarding = shouldShowOnboarding({ completed, skipped, isAdmin })

    const steps = ONBOARDING_STEPS.map((s) => ({
      ...s,
      completed: completedSteps.includes(s.id),
    }))

    const currentStep = nextIncompleteStepIndex(ONBOARDING_STEPS, completedSteps)

    return NextResponse.json({
      showOnboarding,
      completed,
      skipped,
      isAdmin,
      currentStep: currentStep === -1 ? steps.length - 1 : currentStep,
      steps,
    })
  } catch (error) {
    logger.error({ err: error }, 'Onboarding GET error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action, step } = body as { action: string; step?: string }

    switch (action) {
      case 'complete_step': {
        if (!step) return NextResponse.json({ error: 'step is required' }, { status: 400 })
        const valid = ONBOARDING_STEPS.some(s => s.id === step)
        if (!valid) return NextResponse.json({ error: 'Invalid step' }, { status: 400 })

        const raw = getOnboardingSetting('onboarding.completed_steps')
        const parsed = parseCompletedSteps(raw, ONBOARDING_STEPS)
        const steps = markStepCompleted(parsed, step, ONBOARDING_STEPS)
        setOnboardingSetting('onboarding.completed_steps', JSON.stringify(steps), auth.user.username)
        return NextResponse.json({ ok: true, completedSteps: steps })
      }

      case 'complete': {
        setOnboardingSetting('onboarding.completed', 'true', auth.user.username)
        setOnboardingSetting('onboarding.completed_at', String(Date.now()), auth.user.username)
        return NextResponse.json({ ok: true })
      }

      case 'skip': {
        setOnboardingSetting('onboarding.skipped', 'true', auth.user.username)
        return NextResponse.json({ ok: true })
      }

      case 'reset': {
        setOnboardingSetting('onboarding.completed', 'false', auth.user.username)
        setOnboardingSetting('onboarding.completed_at', '', auth.user.username)
        setOnboardingSetting('onboarding.skipped', 'false', auth.user.username)
        setOnboardingSetting('onboarding.completed_steps', '[]', auth.user.username)
        setOnboardingSetting('onboarding.checklist_dismissed', 'false', auth.user.username)
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    logger.error({ err: error }, 'Onboarding POST error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
