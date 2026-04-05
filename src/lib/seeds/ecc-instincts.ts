/**
 * ECC Instinct Seed
 * Seeds high-confidence instinct patterns from everything-claude-code (ECC)
 * into the learned_patterns table via the self-learning engine.
 *
 * WHY: ECC's 38-agent harness distilled 156 skills into confidence-scored
 * instinct YAML files. Seeding these as bootstrap patterns gives Ultron
 * pre-trained intuitions without requiring runtime learning from scratch.
 */

import { recordOrReinforcePattern } from '../self-learning'

interface EccInstinct {
  readonly pattern: string
  readonly patternType: string
  readonly confidence: number
  readonly triggerContext: string
}

// Each entry maps to the RecordPatternInput shape:
// - pattern    → actionTaken  (the concrete behaviour Ultron should exhibit)
// - triggerContext → triggerContext (when/why to apply it)
// - outcome is pinned to 'success' because these are pre-validated ECC instincts
const ECC_INSTINCTS: ReadonlyArray<EccInstinct> = [
  { pattern: 'parallel_agent_dispatch',   patternType: 'orchestration',  confidence: 0.95, triggerContext: 'dispatch independent subtasks as parallel agents to maximize throughput' },
  { pattern: 'read_before_edit',          patternType: 'tool_use',       confidence: 0.99, triggerContext: 'always read file contents before attempting any edit operation' },
  { pattern: 'tsc_noEmit_after_change',   patternType: 'verification',   confidence: 0.97, triggerContext: 'run tsc --noEmit after every TypeScript file modification' },
  { pattern: 'globalThis_singleton',      patternType: 'architecture',   confidence: 0.92, triggerContext: 'use globalThis.__X ??= new X() pattern to survive HMR in Next.js dev mode' },
  { pattern: 'logger_over_console',       patternType: 'logging',        confidence: 0.98, triggerContext: 'use structured logger (pino/winston) instead of console.log in production code' },
  { pattern: 'immutable_state_updates',   patternType: 'data_handling',  confidence: 0.96, triggerContext: 'never mutate objects in-place; always create new copies with spread or Object.assign' },
  { pattern: 'zod_schema_validation',     patternType: 'validation',     confidence: 0.94, triggerContext: 'validate all API request bodies with Zod schemas before processing' },
  { pattern: 'requireRole_before_try',    patternType: 'auth',           confidence: 0.99, triggerContext: 'call requireRole() or ensureAuth() before the try block in all API routes' },
  { pattern: 'workspace_id_on_tables',    patternType: 'database',       confidence: 0.95, triggerContext: 'all new database tables must include workspace_id INTEGER NOT NULL DEFAULT 1' },
  { pattern: 'explicit_return_types',     patternType: 'typescript',     confidence: 0.93, triggerContext: 'all TypeScript functions must have explicit return type annotations' },
  { pattern: 'error_state_ui',            patternType: 'ui',             confidence: 0.91, triggerContext: 'every data-fetching component needs loading, error, and empty states' },
  { pattern: 'max_50_lines_function',     patternType: 'code_quality',   confidence: 0.97, triggerContext: 'keep functions under 50 lines; extract helpers when approaching the limit' },
]

/**
 * Seeds ECC instinct patterns into Ultron's self-learning engine.
 * Safe to call multiple times — duplicate patterns are reinforced, not duplicated.
 */
export function seedECCInstincts(workspaceId: number = 1): void {
  for (const instinct of ECC_INSTINCTS) {
    recordOrReinforcePattern({
      patternType: instinct.patternType,
      triggerContext: instinct.triggerContext,
      actionTaken: instinct.pattern,
      outcome: 'success',
      workspaceId,
    })
  }
}
