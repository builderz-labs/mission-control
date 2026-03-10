let webhookListenerStarted = false
let schedulerStarted = false

export function ensureWebhookListenerStarted() {
  if (webhookListenerStarted) return
  webhookListenerStarted = true

  import('./webhooks').then(({ initWebhookListener }) => {
    initWebhookListener()
  }).catch(() => {
    // Best-effort startup only.
  })
}

export function ensureSchedulerStarted() {
  if (schedulerStarted) return
  schedulerStarted = true

  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    import('./scheduler').then(({ initScheduler }) => {
      initScheduler()
    }).catch(() => {
      // Best-effort startup only.
    })
  }
}
