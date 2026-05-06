/**
 * Server-side wrapper for memory-api.cjs
 *
 * Uses createRequire for ESM → CJS interop.
 * better-sqlite3 (native addon used by memory-api.cjs) is listed in
 * serverExternalPackages in next.config.js so Turbopack does not attempt
 * to bundle it at build time.
 */

import { createRequire } from 'node:module'

const _cjsLoad = createRequire(import.meta.url)
// 3 levels up from src/lib/server/ → project root → scripts/
const memApi = _cjsLoad('../../../scripts/memory-api.cjs')

export const recall      = memApi.recall      as (...args: any[]) => any
export const audit       = memApi.audit       as (...args: any[]) => any
export const review      = memApi.review      as (...args: any[]) => any
export const write       = memApi.write       as (...args: any[]) => any
export const markOutcome = memApi.markOutcome as (...args: any[]) => any
export const status      = memApi.status      as (...args: any[]) => any
export const health      = memApi.health      as (...args: any[]) => any
