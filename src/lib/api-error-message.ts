import { ApiError } from '@/lib/api-client'

export function extractApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const payload = err.payload
    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string' &&
      (payload as { error: string }).error.trim()
    ) {
      return (payload as { error: string }).error
    }
    return fallback
  }
  return err instanceof Error ? err.message : fallback
}
