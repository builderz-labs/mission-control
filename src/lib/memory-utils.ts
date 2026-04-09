/**
 * Memory utilities — legacy entry point re-exported from the split module tree.
 * @see ./memory-utils/index.ts for the implementation.
 */

export {
  extractWikiLinks,
  extractSchema,
  validateSchema,
  scanMemoryFiles,
  buildLinkGraph,
  runHealthDiagnostics,
  generateMOCs,
  generateContextPayload,
  reflectPass,
  reweavePass,
  type WikiLink,
  type SchemaBlock,
  type SchemaValidationResult,
  type MemoryFileInfo,
  type LinkGraphNode,
  type LinkGraph,
  type HealthCategory,
  type HealthReport,
  type MOCEntry,
  type MOCGroup,
  type ContextPayload,
  type ProcessingResult,
} from './memory-utils/index'
