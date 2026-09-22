import { createKeyedRateLimiter } from '@/lib/rate-limit'

/** Subscription-backed setup generation; never bypassed in test mode. */
export const jevAssistantLimiter = createKeyedRateLimiter({
  windowMs: 60_000,
  maxRequests: 6,
  message: 'Too many Jev setup requests. Try again in a minute.',
  critical: true,
})
