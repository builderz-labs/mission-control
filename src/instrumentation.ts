export async function register() {
  if (typeof window !== 'undefined') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.MISSION_CONTROL_TEST_MODE === '1') return

  const { initWebhookListener } = await import('./lib/webhooks')
  initWebhookListener()

  const { initScheduler } = await import('./lib/scheduler')
  initScheduler()
}
