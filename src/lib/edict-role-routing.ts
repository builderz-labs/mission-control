import { normalizeProjectWorkflowMode } from './edict-workflow'

export type EdictRole = 'taizi' | 'zhongshu' | 'menxia' | 'shangshu' | 'liubu' | 'aegis'
export type EdictModelFamily = 'openai' | 'claude_code' | 'minimax'
export type EdictThinkingLevel = 'low' | 'medium' | 'high'
export type EdictRoutingMode = 'model' | 'rule-first'

type JsonObject = Record<string, unknown>

type RoleDefaults = {
  family?: EdictModelFamily
  mode: EdictRoutingMode
  thinking: EdictThinkingLevel
  fallbackFamily?: EdictModelFamily
  fallbackModel?: string
}

type RoleRoutingPolicy = {
  family?: EdictModelFamily
  model?: string
  mode?: EdictRoutingMode
  thinking?: EdictThinkingLevel
  fallback_family?: EdictModelFamily
  fallback_model?: string
}

export interface EdictRoutingState {
  workflow_mode?: unknown
  workflow_template?: unknown
  metadata?: unknown
}

export interface ResolveEdictRoleRouteInput {
  role: EdictRole
  task?: {
    metadata?: unknown
  } | null
  project?: EdictRoutingState | null
  agentConfig?: unknown
  preferredModel?: string | null
}

export interface EdictRoleRouteResolution {
  enabled: boolean
  role: EdictRole
  family: EdictModelFamily | null
  model: string | null
  mode: EdictRoutingMode
  thinking: EdictThinkingLevel | null
  sources: {
    family: 'task_override' | 'project_policy' | 'separation_rule' | 'role_default' | 'agent_config' | null
    model: 'task_override' | 'project_policy' | 'preferred_model' | 'agent_config' | 'global_default' | null
  }
  placeholderModel: boolean
}

const ROLE_DEFAULTS: Record<EdictRole, RoleDefaults> = {
  taizi: { family: 'openai', mode: 'model', thinking: 'low' },
  zhongshu: { family: 'claude_code', mode: 'model', thinking: 'medium' },
  menxia: { family: 'openai', mode: 'model', thinking: 'high' },
  shangshu: { mode: 'rule-first', thinking: 'low', fallbackFamily: 'minimax', fallbackModel: 'minimax-2.7' },
  liubu: { family: 'claude_code', mode: 'model', thinking: 'medium' },
  aegis: { family: 'openai', mode: 'model', thinking: 'high' },
}

const GLOBAL_FAMILY_MODELS: Record<EdictModelFamily, string> = {
  openai: 'openai/gpt-5',
  claude_code: 'anthropic/claude-sonnet-4-20250514',
  minimax: 'minimax-2.7',
}

function asObject(value: unknown): JsonObject {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as JsonObject
      }
    } catch {
      return {}
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject
  }

  return {}
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeFamily(value: unknown): EdictModelFamily | null {
  const raw = asNonEmptyString(value)?.toLowerCase()
  if (!raw) return null
  if (raw === 'openai') return 'openai'
  if (raw === 'claude' || raw === 'claude_code' || raw === 'claude-code') return 'claude_code'
  if (raw === 'minimax') return 'minimax'
  return null
}

function normalizeMode(value: unknown): EdictRoutingMode | null {
  const raw = asNonEmptyString(value)?.toLowerCase()
  if (raw === 'model' || raw === 'rule-first') return raw
  return null
}

function normalizeThinking(value: unknown): EdictThinkingLevel | null {
  const raw = asNonEmptyString(value)?.toLowerCase()
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return null
}

function getNestedRoleRecord(root: JsonObject, path: string, role: EdictRole): JsonObject {
  const container = path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    return (current as JsonObject)[key]
  }, root)
  return asObject(asObject(container)[role])
}

function getTaskRoleOverride(metadata: JsonObject, role: EdictRole): RoleRoutingPolicy {
  const override = getNestedRoleRecord(metadata, 'edict.role_overrides', role)
  const legacyOverride = getNestedRoleRecord(metadata, 'role_overrides', role)
  return {
    family: normalizeFamily(override.family ?? legacyOverride.family) ?? undefined,
    model: asNonEmptyString(override.model ?? legacyOverride.model) ?? undefined,
    mode: normalizeMode(override.mode ?? legacyOverride.mode) ?? undefined,
    thinking: normalizeThinking(override.thinking ?? legacyOverride.thinking) ?? undefined,
  }
}

function getProjectRolePolicy(metadata: JsonObject, role: EdictRole): RoleRoutingPolicy {
  const routing = getNestedRoleRecord(metadata, 'edict.routing', role)
  return {
    family: normalizeFamily(routing.family) ?? undefined,
    model: asNonEmptyString(routing.model) ?? undefined,
    mode: normalizeMode(routing.mode) ?? undefined,
    thinking: normalizeThinking(routing.thinking) ?? undefined,
    fallback_family: normalizeFamily(routing.fallback_family) ?? undefined,
    fallback_model: asNonEmptyString(routing.fallback_model) ?? undefined,
  }
}

function getAgentPrimaryModel(agentConfig: unknown): string | null {
  const config = asObject(agentConfig)
  const model = asObject(config.model)
  return asNonEmptyString(model.primary ?? config.model)
}

export function detectModelFamily(model: string | null | undefined): EdictModelFamily | null {
  const value = asNonEmptyString(model)?.toLowerCase()
  if (!value) return null
  if (value.startsWith('openai/')) return 'openai'
  if (value.startsWith('minimax/')) return 'minimax'
  if (
    value.startsWith('anthropic/')
    || value.startsWith('openrouter/anthropic/')
    || value.includes('/claude-')
    || value.startsWith('claude-')
  ) {
    return 'claude_code'
  }
  return null
}

function getExecutionFamilyFromTask(metadata: JsonObject): EdictModelFamily | null {
  const explicitExecutionModel = asNonEmptyString(metadata.execution_model)
  const explicitExecutionFamily = normalizeFamily(metadata.execution_family)
  if (explicitExecutionFamily) return explicitExecutionFamily
  if (explicitExecutionModel) return detectModelFamily(explicitExecutionModel)

  const edictRouting = asObject(metadata.edict_routing)
  const liubu = asObject(edictRouting.liubu)
  if (liubu.applied === false) return null

  return normalizeFamily(liubu.family) ?? detectModelFamily(asNonEmptyString(liubu.model))
}

function getTaskLevelModelOverride(metadata: JsonObject, role: EdictRole, roleOverride: RoleRoutingPolicy): string | null {
  if (role === 'liubu') {
    return asNonEmptyString(metadata.execution_model) ?? roleOverride.model ?? null
  }
  if (role === 'aegis') {
    return asNonEmptyString(metadata.review_model) ?? roleOverride.model ?? null
  }
  return roleOverride.model ?? null
}

function getTaskLevelFamilyOverride(metadata: JsonObject, role: EdictRole, roleOverride: RoleRoutingPolicy): EdictModelFamily | null {
  if (role === 'liubu') {
    return normalizeFamily(metadata.execution_family) ?? roleOverride.family ?? null
  }
  if (role === 'aegis') {
    return normalizeFamily(metadata.review_family) ?? roleOverride.family ?? null
  }
  return roleOverride.family ?? null
}

function getAlternateReviewFamily(executionFamily: EdictModelFamily | null): EdictModelFamily | null {
  if (executionFamily === 'openai') return 'claude_code'
  if (executionFamily === 'claude_code') return 'openai'
  return null
}

export function resolveEdictRoleRoute(input: ResolveEdictRoleRouteInput): EdictRoleRouteResolution {
  const project = input.project ?? null
  const workflowMode = normalizeProjectWorkflowMode(project?.workflow_mode ?? project?.workflow_template)
  const defaults = ROLE_DEFAULTS[input.role]

  if (workflowMode !== 'edict_v1') {
    return {
      enabled: false,
      role: input.role,
      family: null,
      model: null,
      mode: defaults.mode,
      thinking: null,
      sources: { family: null, model: null },
      placeholderModel: false,
    }
  }

  const taskMetadata = asObject(input.task?.metadata)
  const projectMetadata = asObject(project?.metadata)
  const taskRoleOverride = getTaskRoleOverride(taskMetadata, input.role)
  const projectRolePolicy = getProjectRolePolicy(projectMetadata, input.role)
  const agentModel = getAgentPrimaryModel(input.agentConfig)
  const agentFamily = detectModelFamily(agentModel)
  const preferredModelFamily = detectModelFamily(input.preferredModel)
  const taskModelOverride = getTaskLevelModelOverride(taskMetadata, input.role, taskRoleOverride)
  const taskFamilyOverride = getTaskLevelFamilyOverride(taskMetadata, input.role, taskRoleOverride) ?? detectModelFamily(taskModelOverride)
  const explicitProjectFamily = projectRolePolicy.family ?? projectRolePolicy.fallback_family ?? detectModelFamily(projectRolePolicy.model ?? projectRolePolicy.fallback_model) ?? null
  const explicitProjectModel = projectRolePolicy.model ?? projectRolePolicy.fallback_model ?? null

  let family = taskFamilyOverride
  let familySource: EdictRoleRouteResolution['sources']['family'] = taskFamilyOverride ? 'task_override' : null

  if (!family && explicitProjectFamily) {
    family = explicitProjectFamily
    familySource = 'project_policy'
  }

  if (!family) {
    family = defaults.family ?? defaults.fallbackFamily ?? null
    familySource = family ? 'role_default' : null
  }

  if (
    input.role === 'aegis'
    && !taskModelOverride
    && !taskFamilyOverride
    && !explicitProjectModel
    && !explicitProjectFamily
  ) {
    const executionFamily = getExecutionFamilyFromTask(taskMetadata)
    if (executionFamily && family === executionFamily) {
      const alternateFamily = getAlternateReviewFamily(executionFamily)
      if (alternateFamily) {
        family = alternateFamily
        familySource = 'separation_rule'
      }
    }
  }

  let model = taskModelOverride
  let modelSource: EdictRoleRouteResolution['sources']['model'] = taskModelOverride ? 'task_override' : null

  if (!model && explicitProjectModel) {
    model = explicitProjectModel
    modelSource = 'project_policy'
  }

  if (!model && input.preferredModel && (!family || preferredModelFamily === family)) {
    model = input.preferredModel
    modelSource = 'preferred_model'
  }

  if (!model && agentModel && (!family || agentFamily === family)) {
    model = agentModel
    modelSource = 'agent_config'
  }

  if (!model && family) {
    model = GLOBAL_FAMILY_MODELS[family]
    modelSource = 'global_default'
  }

  return {
    enabled: true,
    role: input.role,
    family,
    model,
    mode: taskRoleOverride.mode ?? projectRolePolicy.mode ?? defaults.mode,
    thinking: taskRoleOverride.thinking ?? projectRolePolicy.thinking ?? defaults.thinking,
    sources: {
      family: familySource,
      model: modelSource,
    },
    placeholderModel: model === 'minimax-2.7',
  }
}
