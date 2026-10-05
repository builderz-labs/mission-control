export type CapabilityAdoptionState = 'ACTIVE' | 'CANDIDATE' | 'HOLD' | 'REJECTED'

export interface ExternalCapabilityCandidate {
  id: string
  name: string
  category: 'memory' | 'optimizer' | 'agent-training' | 'eval' | 'analytics' | 'automation' | 'connector'
  source: string
  license: string
  adoption_state: CapabilityAdoptionState
  why: string
  guardrails: string[]
}

export const externalCapabilityCandidates: readonly ExternalCapabilityCandidate[] = [
  {
    id: 'skillmem',
    name: 'skillmem',
    category: 'memory',
    source: 'local skillmem v0.12.1',
    license: 'Apache-2.0',
    adoption_state: 'ACTIVE',
    why: 'Local skill memory with provenance and reinforcement/decay semantics already integrated read-only.',
    guardrails: [
      'read-only compatibility remains the default',
      'no agent-written skill becomes trusted automatically',
      'reinforcement requires external evidence or explicit human confirmation',
      'hooks/MCP/semantic retrieval stay off until compatibility tests pass',
    ],
  },
  {
    id: 'promptfoo',
    name: 'promptfoo',
    category: 'eval',
    source: 'promptfoo/promptfoo',
    license: 'MIT',
    adoption_state: 'CANDIDATE',
    why: 'Local-first regression/eval harness for prompts, agents and skill candidates before promotion.',
    guardrails: [
      'start with deterministic assertions, fixtures or approved local/custom providers',
      'no external model provider call without an explicit budget/credential decision',
      'eval success is evidence, not permission to auto-promote',
    ],
  },
  {
    id: 'memskill',
    name: 'MemSkill',
    category: 'memory',
    source: 'ViktorAxelsen/MemSkill',
    license: 'verify before any installation',
    adoption_state: 'HOLD',
    why: 'Interesting self-evolving memory research, but overlaps the existing skillmem + Control Tower learning loop.',
    guardrails: [
      'research/watchlist only',
      'do not introduce a second writable memory authority',
      'revisit only if skillmem cannot support a measured memory requirement',
    ],
  },
  {
    id: 'gepa',
    name: 'GEPA / DSPy GEPA',
    category: 'optimizer',
    source: 'gepa-ai/gepa and stanfordnlp/dspy',
    license: 'verify repository version before installation',
    adoption_state: 'CANDIDATE',
    why: 'Useful for evidence-backed prompt/component optimization when a measurable eval set exists.',
    guardrails: [
      'never auto-run from normal operations',
      'requires explicit experiment, eval set and budget',
      'candidate output must pass regression and human promotion gate',
    ],
  },
  {
    id: 'evoagentx',
    name: 'EvoAgentX',
    category: 'optimizer',
    source: 'ANative-Lab/EvoAgentX',
    license: 'MIT',
    adoption_state: 'CANDIDATE',
    why: 'Research candidate for self-evolving agent workflows, not required for the current deterministic learning loop.',
    guardrails: [
      'do not install into production path by default',
      'evaluate in isolated experiment only',
      'no permission/security/release policy mutation',
    ],
  },
  {
    id: 'agent-lightning',
    name: 'Agent Lightning',
    category: 'agent-training',
    source: 'microsoft/agent-lightning',
    license: 'MIT',
    adoption_state: 'CANDIDATE',
    why: 'Potential future benchmark-driven agent training layer; current one-person operations do not justify RL infrastructure.',
    guardrails: [
      'research only until a large repeatable benchmark exists',
      'no automatic training jobs',
      'requires explicit compute/budget approval',
    ],
  },
  {
    id: 'umami',
    name: 'Umami',
    category: 'analytics',
    source: 'umami-software/umami',
    license: 'MIT',
    adoption_state: 'CANDIDATE',
    why: 'Lightweight first-party traffic/campaign/conversion analytics that fits low-cost self-hosted operations.',
    guardrails: [
      'do not deploy until ProductBaton/Shufuro tracking plan is approved',
      'collect only necessary first-party events',
      'social platform metrics remain sourced from official APIs/manual exports, not inferred from web analytics',
    ],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'analytics',
    source: 'PostHog/posthog',
    license: 'MIT core with repository-specific enterprise portions',
    adoption_state: 'HOLD',
    why: 'Powerful product analytics/experiments, but heavier than needed for the current stage.',
    guardrails: [
      'prefer Umami or existing analytics until feature depth is justified',
      'do not add infrastructure merely for dashboards',
    ],
  },
  {
    id: 'n8n',
    name: 'n8n',
    category: 'automation',
    source: 'n8n-io/n8n',
    license: 'Sustainable Use License with enterprise-specific portions',
    adoption_state: 'HOLD',
    why: 'Capable orchestration, but Control Tower already owns routing and the license/operational surface adds complexity.',
    guardrails: [
      'only revisit for a concrete connector gap',
      'do not duplicate Control Tower orchestration',
    ],
  },
] as const
