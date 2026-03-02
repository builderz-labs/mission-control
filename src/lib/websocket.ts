'use client'

/**
 * Legacy compatibility shim.
 *
 * All WebSocket logic has been moved to `@/lib/gateway/`.
 * This module re-exports `useGateway` as `useWebSocket` so existing
 * imports continue to work without changes.
 */
export { useGateway as useWebSocket } from '@/lib/gateway'
