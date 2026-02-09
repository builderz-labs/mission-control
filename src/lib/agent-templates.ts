/**
 * Agent Templates Library
 *
 * Defines 7 agent archetypes based on production jarv config patterns.
 * Each template provides a full OpenClaw agent config structure that
 * can be customized before creating an agent.
 */

export interface AgentToolsConfig {
  allow: string[]
  deny: string[]
}

export interface AgentSandboxConfig {
  mode: 'all' | 'non-main'
  workspaceAccess: 'rw' | 'ro' | 'none'
  scope: 'agent'
  docker?: {
    network: 'none' | 'bridge'
  }
}

export interface AgentModelConfig {
  primary: string
  fallbacks: string[]
}

export interface AgentIdentityConfig {
  name: string
  theme: string
  emoji: string
}

export interface AgentSubagentsConfig {
  allowAgents?: string[]
  model?: string
}

export interface AgentMemorySearchConfig {
  sources: string[]
  experimental?: {
    sessionMemory?: boolean
  }
}

export interface OpenClawAgentConfig {
  id: string
  name?: string
  workspace?: string
  agentDir?: string
  model: AgentModelConfig
  identity: AgentIdentityConfig
  subagents?: AgentSubagentsConfig
  sandbox: AgentSandboxConfig
  tools: AgentToolsConfig
  memorySearch?: AgentMemorySearchConfig
}

export interface AgentTemplate {
  type: string
  label: string
  description: string
  emoji: string
  modelTier: 'opus' | 'sonnet' | 'haiku'
  toolCount: number
  config: Omit<OpenClawAgentConfig, 'id' | 'workspace' | 'agentDir'>
}

// Tool groups for template composition
const TOOL_GROUPS = {
  coding: ['read', 'write', 'edit', 'apply_patch', 'exec', 'bash', 'process'],
  browser: ['browser', 'web'],
  memory: ['memory_search', 'memory_get'],
  session: ['agents_list', 'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'session_status'],
  subagent: ['subagents', 'lobster', 'llm-task'],
  thinking: ['thinking', 'reactions', 'skills'],
  readonly: ['read', 'memory_search', 'memory_get', 'agents_list'],
} as const

const COMMON_DENY = ['clawhub', 'cron', 'gateway', 'nodes']

const SONNET_FALLBACKS = [
  'openrouter/anthropic/claude-sonnet-4',
  'moonshot/kimi-k2-thinking',
  'openrouter/moonshotai/kimi-k2.5',
  'nvidia/moonshotai/kimi-k2-instruct',
  'openai/codex-mini-latest',
  'ollama/qwen2.5-coder:14b',
]

const OPUS_FALLBACKS = [
  'anthropic/claude-sonnet-4-20250514',
  'moonshot/kimi-k2-thinking',
  'nvidia/moonshotai/kimi-k2-instruct',
  'openrouter/moonshotai/kimi-k2.5',
  'openai/codex-mini-latest',
]

const HAIKU_FALLBACKS = [
  'anthropic/claude-sonnet-4-20250514',
  'ollama/qwen2.5-coder:14b',
  'openai/codex-mini-latest',
]

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    type: 'orchestrator',
    label: 'Orchestrator',
    description: 'Primary coordinator with full tool access. Routes tasks to specialist agents and manages workflows.',
    emoji: '\ud83e\udded',
    modelTier: 'opus',
    toolCount: 23,
    config: {
      model: {
        primary: 'anthropic/claude-opus-4-5',
        fallbacks: OPUS_FALLBACKS,
      },
      identity: {
        name: '',
        theme: 'operator strategist',
        emoji: '\ud83e\udded',
      },
      subagents: {
        allowAgents: [],
      },
      sandbox: {
        mode: 'non-main',
        workspaceAccess: 'rw',
        scope: 'agent',
      },
      tools: {
        allow: [
          ...TOOL_GROUPS.coding,
          ...TOOL_GROUPS.browser,
          ...TOOL_GROUPS.memory,
          ...TOOL_GROUPS.session,
          ...TOOL_GROUPS.subagent,
          ...TOOL_GROUPS.thinking,
        ],
        deny: COMMON_DENY,
      },
      memorySearch: {
        sources: ['memory', 'sessions'],
        experimental: { sessionMemory: true },
      },
    },
  },
  {
    type: 'developer',
    label: 'Developer',
    description: 'Full-stack builder with Docker bridge networking, exec/write access, and subagent spawning.',
    emoji: '\ud83d\udee0\ufe0f',
    modelTier: 'sonnet',
    toolCount: 21,
    config: {
      model: {
        primary: 'anthropic/claude-sonnet-4-20250514',
        fallbacks: SONNET_FALLBACKS,
      },
      identity: {
        name: '',
        theme: 'builder engineer',
        emoji: '\ud83d\udee0\ufe0f',
      },
      subagents: {
        allowAgents: [],
        model: 'openai/codex-mini-latest',
      },
      sandbox: {
        mode: 'all',
        workspaceAccess: 'rw',
        scope: 'agent',
        docker: { network: 'bridge' },
      },
      tools: {
        allow: [
          ...TOOL_GROUPS.coding,
          ...TOOL_GROUPS.browser,
          ...TOOL_GROUPS.memory,
          'agents_list', 'sessions_spawn', 'sessions_history', 'session_status',
          ...TOOL_GROUPS.subagent,
          ...TOOL_GROUPS.thinking,
        ],
        deny: [...COMMON_DENY, 'sessions_send'],
      },
      memorySearch: {
        sources: ['memory', 'sessions'],
        experimental: { sessionMemory: true },
      },
    },
  },
  {
    type: 'specialist-dev',
    label: 'Specialist Dev',
    description: 'Focused developer for specific domains (frontend, backend, blockchain). Docker bridge + write access.',
    emoji: '\u2699\ufe0f',
    modelTier: 'sonnet',
    toolCount: 15,
    config: {
      model: {
        primary: 'anthropic/claude-sonnet-4-20250514',
        fallbacks: SONNET_FALLBACKS,
      },
      identity: {
        name: '',
        theme: 'specialist developer',
        emoji: '\u2699\ufe0f',
      },
      subagents: {
        model: 'openai/codex-mini-latest',
      },
      sandbox: {
        mode: 'all',
        workspaceAccess: 'rw',
        scope: 'agent',
        docker: { network: 'bridge' },
      },
      tools: {
        allow: [
          ...TOOL_GROUPS.coding,
          ...TOOL_GROUPS.memory,
          'agents_list', 'sessions_spawn', 'session_status',
          'subagents', 'llm-task',
          'thinking', 'reactions', 'skills',
        ],
        deny: [...COMMON_DENY, 'sessions_send', 'browser', 'web', 'lobster'],
      },
      memorySearch: {
        sources: ['memory', 'sessions'],
        experimental: { sessionMemory: true },
      },
    },
  },
  {
    type: 'reviewer',
    label: 'Reviewer / QA',
    description: 'Read-only access for code review, quality gates, and auditing. Lightweight Haiku model.',
    emoji: '\ud83d\udd2c',
    modelTier: 'haiku',
    toolCount: 7,
    config: {
      model: {
        primary: 'anthropic/claude-haiku-4-5',
        fallbacks: HAIKU_FALLBACKS,
      },
      identity: {
        name: '',
        theme: 'quality reviewer',
        emoji: '\ud83d\udd2c',
      },
      sandbox: {
        mode: 'all',
        workspaceAccess: 'ro',
        scope: 'agent',
      },
      tools: {
        allow: [
          'read', 'memory_search', 'memory_get',
          'agents_list', 'thinking', 'reactions', 'skills',
        ],
        deny: [
          ...COMMON_DENY,
          'write', 'edit', 'apply_patch', 'exec', 'bash', 'process',
          'browser', 'web', 'sessions_send', 'sessions_spawn', 'lobster',
        ],
      },
      memorySearch: {
        sources: ['memory'],
      },
    },
  },
  {
    type: 'researcher',
    label: 'Researcher',
    description: 'Browser and web access for research tasks. No workspace or code execution.',
    emoji: '\ud83d\udd0d',
    modelTier: 'sonnet',
    toolCount: 8,
    config: {
      model: {
        primary: 'anthropic/claude-sonnet-4-20250514',
        fallbacks: SONNET_FALLBACKS,
      },
      identity: {
        name: '',
        theme: 'research analyst',
        emoji: '\ud83d\udd0d',
      },
      sandbox: {
        mode: 'all',
        workspaceAccess: 'none',
        scope: 'agent',
      },
      tools: {
        allow: [
          'browser', 'web',
          'memory_search', 'memory_get',
          'agents_list', 'thinking', 'reactions', 'skills',
        ],
        deny: [
          ...COMMON_DENY,
          'read', 'write', 'edit', 'apply_patch', 'exec', 'bash', 'process',
          'sessions_send', 'sessions_spawn', 'lobster',
        ],
      },
      memorySearch: {
        sources: ['memory', 'sessions'],
      },
    },
  },
  {
    type: 'content-creator',
    label: 'Content Creator',
    description: 'Write and edit access for content generation. No code execution or browser.',
    emoji: '\u270f\ufe0f',
    modelTier: 'haiku',
    toolCount: 9,
    config: {
      model: {
        primary: 'anthropic/claude-haiku-4-5',
        fallbacks: HAIKU_FALLBACKS,
      },
      identity: {
        name: '',
        theme: 'content creator',
        emoji: '\u270f\ufe0f',
      },
      sandbox: {
        mode: 'all',
        workspaceAccess: 'none',
        scope: 'agent',
      },
      tools: {
        allow: [
          'write', 'edit',
          'memory_search', 'memory_get',
          'agents_list',
          'thinking', 'reactions', 'skills',
          'web',
        ],
        deny: [
          ...COMMON_DENY,
          'read', 'apply_patch', 'exec', 'bash', 'process',
          'browser', 'sessions_send', 'sessions_spawn', 'lobster',
          'subagents', 'llm-task',
        ],
      },
      memorySearch: {
        sources: ['memory'],
      },
    },
  },
  {
    type: 'security-auditor',
    label: 'Security Auditor',
    description: 'Read-only workspace with bash for security scanning. No write access to prevent tampering.',
    emoji: '\ud83d\udee1\ufe0f',
    modelTier: 'sonnet',
    toolCount: 10,
    config: {
      model: {
        primary: 'anthropic/claude-sonnet-4-20250514',
        fallbacks: SONNET_FALLBACKS,
      },
      identity: {
        name: '',
        theme: 'security auditor',
        emoji: '\ud83d\udee1\ufe0f',
      },
      sandbox: {
        mode: 'all',
        workspaceAccess: 'ro',
        scope: 'agent',
      },
      tools: {
        allow: [
          'read', 'exec', 'bash',
          'memory_search', 'memory_get',
          'agents_list',
          'thinking', 'reactions', 'skills',
          'web',
        ],
        deny: [
          ...COMMON_DENY,
          'write', 'edit', 'apply_patch', 'process',
          'browser', 'sessions_send', 'sessions_spawn', 'lobster',
          'subagents', 'llm-task',
        ],
      },
      memorySearch: {
        sources: ['memory'],
      },
    },
  },
]

/** Get a template by type name */
export function getTemplate(type: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find(t => t.type === type)
}

/** Build a full OpenClaw agent config from a template + overrides */
export function buildAgentConfig(
  template: AgentTemplate,
  overrides: {
    id: string
    name: string
    workspace?: string
    agentDir?: string
    emoji?: string
    theme?: string
    model?: string
    workspaceAccess?: 'rw' | 'ro' | 'none'
    sandboxMode?: 'all' | 'non-main'
    dockerNetwork?: 'none' | 'bridge'
    subagentAllowAgents?: string[]
  }
): OpenClawAgentConfig {
  const config = structuredClone(template.config)

  config.identity.name = overrides.name
  if (overrides.emoji) config.identity.emoji = overrides.emoji
  if (overrides.theme) config.identity.theme = overrides.theme
  if (overrides.model) config.model.primary = overrides.model
  if (overrides.workspaceAccess) config.sandbox.workspaceAccess = overrides.workspaceAccess
  if (overrides.sandboxMode) config.sandbox.mode = overrides.sandboxMode

  if (overrides.dockerNetwork) {
    config.sandbox.docker = { network: overrides.dockerNetwork }
  }

  if (overrides.subagentAllowAgents && config.subagents) {
    config.subagents.allowAgents = overrides.subagentAllowAgents
  }

  return {
    id: overrides.id,
    name: overrides.name,
    workspace: overrides.workspace,
    agentDir: overrides.agentDir,
    ...config,
  }
}

/** Model tier display info for UI */
export const MODEL_TIERS = {
  opus: { label: 'Opus', color: 'purple', costIndicator: '$$$' },
  sonnet: { label: 'Sonnet', color: 'blue', costIndicator: '$$' },
  haiku: { label: 'Haiku', color: 'green', costIndicator: '$' },
} as const

/** Tool group labels for UI checkboxes */
export const TOOL_GROUP_LABELS = {
  coding: 'Coding (read/write/exec)',
  browser: 'Browser & Web',
  memory: 'Memory Search',
  session: 'Session Management',
  subagent: 'Subagents & LLM Tasks',
  thinking: 'Thinking & Skills',
  readonly: 'Read-only',
} as const
