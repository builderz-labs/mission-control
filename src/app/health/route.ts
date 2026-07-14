import { GET as healthGet } from '../api/health/route'

/**
 * Bare /health alias for upstream probes that don't use the /api prefix.
 * Mirrors /api/health exactly (same JSON shape, status codes, and lack of
 * auth). Implemented as a re-export rather than a redirect so probes get the
 * payload directly without a 3xx hop.
 */
export const GET = healthGet
