/**
 * Memory utilities — public barrel.
 *
 * Existing imports from '@/lib/memory-utils' continue to work via this index.
 */

export type { WikiLink } from './wiki-links'
export { extractWikiLinks } from './wiki-links'

export type { SchemaBlock, SchemaValidationResult } from './schema-validation'
export { extractSchema, validateSchema } from './schema-validation'

export type {
  MemoryFileInfo,
  LinkGraphNode,
  LinkGraph,
  HealthCategory,
  HealthReport,
} from './health-diagnostics'
export {
  scanMemoryFiles,
  buildLinkGraph,
  runHealthDiagnostics,
} from './health-diagnostics'

export type {
  MOCEntry,
  MOCGroup,
  ContextPayload,
  ProcessingResult,
} from './moc-generation'
export {
  generateMOCs,
  generateContextPayload,
  reflectPass,
  reweavePass,
} from './moc-generation'
