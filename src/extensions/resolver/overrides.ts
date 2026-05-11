/**
 * Resolver Override File Management
 *
 * Provides read/write access to the resolver-overrides.json convention file,
 * which curates per-tool/skill description overrides and added keywords to
 * improve classification accuracy in the openclaw-tool-resolver plugin.
 *
 * ──────────────────────────────────────────────────────────────
 * STATUS: MC SIDE ONLY — Overrides are NOT yet applied by the resolver.
 * ──────────────────────────────────────────────────────────────
 *
 * Applying overrides requires a change to the upstream resolver plugin
 * (stroupaloop/openclaw-resolver). MC's current role is:
 *   1. Surface weak-description candidates from telemetry data
 *   2. Allow operators to curate the override list via the UI/API
 *   3. Persist the overrides.json file so the resolver can eventually load it
 *
 * Once the resolver plugin gains override support, it will read this file at
 * startup (configurable via MC_RESOLVER_OVERRIDES_PATH). No MC changes will be
 * needed at that point.
 *
 * File path resolution (in priority order):
 *   1. MC_RESOLVER_OVERRIDES_PATH env var (absolute path)
 *   2. <getOpenclawWorkspaceDir()>/resolver-overrides.json
 *   3. Empty string (disabled — reads return null, writes throw)
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getOpenclawWorkspaceDir } from './workspace-paths'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ResolverOverride {
  /** Stronger hand-written description that helps the classifier. */
  description?: string
  /** Extra keywords the classifier should associate with this tool/skill. */
  addedKeywords?: string[]
  /** Human-readable notes about why this override exists. */
  notes?: string
}

export interface ResolverOverridesFile {
  version: 1
  updatedAt: string // ISO-8601
  overrides: Record<string, ResolverOverride>
}

export interface ValidationError {
  field: string
  message: string
}

// ── Path resolution ────────────────────────────────────────────────────────────

export function resolveOverridesPath(): string {
  if (process.env.MC_RESOLVER_OVERRIDES_PATH) {
    return process.env.MC_RESOLVER_OVERRIDES_PATH
  }
  const workspaceDir = getOpenclawWorkspaceDir()
  if (workspaceDir) {
    return path.join(workspaceDir, 'resolver-overrides.json')
  }
  return ''
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validate a single override entry. Returns an array of validation errors
 * (empty array means valid).
 */
export function validateOverride(id: string, override: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!id || typeof id !== 'string' || !id.trim()) {
    errors.push({ field: 'id', message: 'Tool/skill ID must be a non-empty string' })
  } else if (!/^[\w:./-]+$/.test(id.trim())) {
    errors.push({
      field: 'id',
      message: 'Tool/skill ID may only contain word chars, colons, dots, hyphens, and slashes',
    })
  }

  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    errors.push({ field: 'override', message: 'Override must be an object' })
    return errors
  }

  const o = override as Record<string, unknown>

  if (o.description !== undefined) {
    if (typeof o.description !== 'string') {
      errors.push({ field: 'description', message: 'description must be a string' })
    } else if (o.description.trim().length === 0) {
      errors.push({ field: 'description', message: 'description must not be empty if provided' })
    } else if (o.description.length > 2000) {
      errors.push({ field: 'description', message: 'description must be ≤ 2000 characters' })
    }
  }

  if (o.addedKeywords !== undefined) {
    if (!Array.isArray(o.addedKeywords)) {
      errors.push({ field: 'addedKeywords', message: 'addedKeywords must be an array' })
    } else {
      for (let i = 0; i < o.addedKeywords.length; i++) {
        if (typeof o.addedKeywords[i] !== 'string') {
          errors.push({ field: `addedKeywords[${i}]`, message: 'Each keyword must be a string' })
        } else if ((o.addedKeywords[i] as string).trim().length === 0) {
          errors.push({ field: `addedKeywords[${i}]`, message: 'Keywords must not be empty strings' })
        }
      }
      if (o.addedKeywords.length > 50) {
        errors.push({ field: 'addedKeywords', message: 'addedKeywords must have ≤ 50 entries' })
      }
    }
  }

  if (o.notes !== undefined) {
    if (typeof o.notes !== 'string') {
      errors.push({ field: 'notes', message: 'notes must be a string' })
    } else if (o.notes.length > 1000) {
      errors.push({ field: 'notes', message: 'notes must be ≤ 1000 characters' })
    }
  }

  // Reject unknown keys
  const knownKeys = new Set(['description', 'addedKeywords', 'notes'])
  for (const key of Object.keys(o)) {
    if (!knownKeys.has(key)) {
      errors.push({ field: key, message: `Unknown field: ${key}` })
    }
  }

  return errors
}

/**
 * Validate the full overrides file structure.
 */
export function validateOverridesFile(data: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [{ field: 'root', message: 'Must be a JSON object' }]
  }

  const d = data as Record<string, unknown>

  if (d.version !== 1) {
    errors.push({ field: 'version', message: 'version must be 1' })
  }

  if (typeof d.updatedAt !== 'string') {
    errors.push({ field: 'updatedAt', message: 'updatedAt must be an ISO-8601 string' })
  }

  if (!d.overrides || typeof d.overrides !== 'object' || Array.isArray(d.overrides)) {
    errors.push({ field: 'overrides', message: 'overrides must be an object' })
  } else {
    for (const [id, override] of Object.entries(d.overrides)) {
      const entryErrors = validateOverride(id, override)
      for (const e of entryErrors) {
        errors.push({ field: `overrides.${id}.${e.field}`, message: e.message })
      }
    }
  }

  return errors
}

// ── Read ───────────────────────────────────────────────────────────────────────

/**
 * Read the overrides file from disk. Returns null if the file doesn't exist.
 * Throws on parse errors or validation failures.
 */
export function readOverrides(filePath?: string): ResolverOverridesFile | null {
  const p = filePath ?? resolveOverridesPath()
  if (!p) return null

  if (!fs.existsSync(p)) return null

  let raw: string
  try {
    raw = fs.readFileSync(p, 'utf-8')
  } catch (err: any) {
    throw new Error(`Failed to read overrides file at ${p}: ${err.message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err: any) {
    throw new Error(`Overrides file at ${p} is not valid JSON: ${err.message}`)
  }

  const errors = validateOverridesFile(parsed)
  if (errors.length > 0) {
    throw new Error(
      `Overrides file at ${p} failed validation:\n${errors.map((e) => `  ${e.field}: ${e.message}`).join('\n')}`,
    )
  }

  return parsed as ResolverOverridesFile
}

// ── Write ──────────────────────────────────────────────────────────────────────

/**
 * Atomically write the overrides file (write to temp, then rename).
 * Ensures parent directory exists.
 */
export function writeOverrides(overrides: ResolverOverridesFile, filePath?: string): void {
  const p = filePath ?? resolveOverridesPath()
  if (!p) {
    throw new Error(
      'Cannot write overrides: no path configured. Set MC_RESOLVER_OVERRIDES_PATH or OPENCLAW_WORKSPACE_DIR.',
    )
  }

  const errors = validateOverridesFile(overrides)
  if (errors.length > 0) {
    throw new Error(
      `Cannot write invalid overrides:\n${errors.map((e) => `  ${e.field}: ${e.message}`).join('\n')}`,
    )
  }

  const dir = path.dirname(p)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const serialized = JSON.stringify(overrides, null, 2) + '\n'
  const tmpPath = path.join(os.tmpdir(), `resolver-overrides-${process.pid}-${Date.now()}.json.tmp`)

  try {
    fs.writeFileSync(tmpPath, serialized, 'utf-8')
    fs.renameSync(tmpPath, p)
  } catch (err: any) {
    // Cleanup temp if rename failed
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    throw new Error(`Failed to write overrides to ${p}: ${err.message}`)
  }
}

// ── Convenience helpers ────────────────────────────────────────────────────────

/**
 * Upsert a single override. Reads the current file (or starts fresh),
 * applies the upsert, writes back atomically.
 */
export function upsertOverride(
  id: string,
  override: ResolverOverride,
  filePath?: string,
): ResolverOverridesFile {
  const errors = validateOverride(id, override)
  if (errors.length > 0) {
    throw new Error(
      `Invalid override for ${id}:\n${errors.map((e) => `  ${e.field}: ${e.message}`).join('\n')}`,
    )
  }

  const current = readOverrides(filePath) ?? {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    overrides: {},
  }

  const updated: ResolverOverridesFile = {
    ...current,
    updatedAt: new Date().toISOString(),
    overrides: {
      ...current.overrides,
      [id]: override,
    },
  }

  writeOverrides(updated, filePath)
  return updated
}

/**
 * Remove a single override. No-op if the ID doesn't exist.
 */
export function removeOverride(id: string, filePath?: string): ResolverOverridesFile | null {
  const current = readOverrides(filePath)
  if (!current) return null
  if (!(id in current.overrides)) return current

  const { [id]: _removed, ...rest } = current.overrides
  const updated: ResolverOverridesFile = {
    ...current,
    updatedAt: new Date().toISOString(),
    overrides: rest,
  }

  writeOverrides(updated, filePath)
  return updated
}
