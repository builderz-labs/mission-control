import { GET as healthGet } from '../api/health/route'

/**
 * Bare /health alias for upstream probes that don't use the /api prefix
 * (Pandora backend.api_digest.py:520, background_tasks.py:2643).
 *
 * Mirrors /api/health exactly — same JSON shape, same status codes,
 * same lack of auth. Implemented as a re-export rather than a redirect
 * so probes get the payload directly without a 3xx hop.
 */
export const GET = healthGet
