/**
 * Next.js Instrumentation Hook
 *
 * Runs once when the server starts. Initializes the autonomous engines
 * (self-healing, self-improving) so background tasks like the health
 * pulse begin immediately rather than waiting for the first request.
 *
 * Next.js 15+ auto-detects this file in src/instrumentation.ts.
 */
import { logger } from '@/lib/logger'

export async function register(): Promise<void> {
  // Only run on the Node.js server runtime, not in Edge or during build
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return
  }

  try {
    // Dynamic imports avoid bundling server-only modules into the client
    const { selfHealingEngine } = await import('@/lib/self-healing')
    selfHealingEngine.start()

    const { selfImprovingEngine } = await import('@/lib/self-improving')
    selfImprovingEngine.initialize()
  } catch (error) {
    // Log but don't crash the server -- engines are non-critical
    logger.error({ err: error }, '[instrumentation] Failed to start autonomous engines')
  }
}
