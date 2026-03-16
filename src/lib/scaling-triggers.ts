/**
 * Event-driven scaling triggers.
 *
 * Subscribes to task lifecycle events and evaluates auto-approve scaling
 * policies when queue depth changes. Lazy initialization — only activates
 * when SIMULATION_ENABLED=true.
 */

import { eventBus } from '@/lib/event-bus'
import { getDatabase } from '@/lib/db'
import { evaluateScaling, executeScaleUp, executeScaleDown } from '@/lib/scaling-engine'
import { logger } from '@/lib/logger'

let initialized = false

/** Debounce: skip if last evaluation was < 10s ago. */
let lastEvalTime = 0
const EVAL_COOLDOWN_MS = 10_000

/**
 * Wire EventBus task events to scaling evaluation.
 * Call once at startup (e.g., from simulation engine start).
 * Idempotent — safe to call multiple times.
 */
export function initScalingTriggers(): void {
  if (initialized) return
  initialized = true

  const handler = () => {
    const now = Date.now()
    if (now - lastEvalTime < EVAL_COOLDOWN_MS) return
    lastEvalTime = now

    evaluateAutoApprovePolicies()
  }

  eventBus.on('server-event', (event: { type: string }) => {
    if (
      event.type === 'task.created' ||
      event.type === 'task.status_changed' ||
      event.type === 'task.deleted'
    ) {
      handler()
    }
  })

  logger.info('Scaling triggers initialized — listening for task events')
}

function evaluateAutoApprovePolicies(): void {
  try {
    const db = getDatabase()
    const policies = db.prepare(
      'SELECT id, workspace_id FROM scaling_policies WHERE enabled = 1 AND auto_approve = 1'
    ).all() as Array<{ id: number; workspace_id: number }>

    for (const policy of policies) {
      try {
        const event = evaluateScaling(db, policy.id, policy.workspace_id)

        if (event && event.event_type === 'scale_up') {
          executeScaleUp(db, event.id, policy.workspace_id)
          logger.info({ policyId: policy.id, eventId: event.id }, 'Event-triggered scale up')
        } else if (event && event.event_type === 'scale_down' && event.agent_id) {
          executeScaleDown(db, event.id, event.agent_id, policy.workspace_id)
          logger.info({ policyId: policy.id, eventId: event.id }, 'Event-triggered scale down')
        }
      } catch (err) {
        logger.warn({ err, policyId: policy.id }, 'Event-triggered scaling evaluation failed')
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Scaling trigger evaluation failed')
  }
}

/** Reset for testing. */
export function resetScalingTriggers(): void {
  initialized = false
  lastEvalTime = 0
}
