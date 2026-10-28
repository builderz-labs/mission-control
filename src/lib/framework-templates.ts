/**
 * Framework-Agnostic Template System
 *
 * Extends the existing OpenClaw templates with framework-neutral archetypes
 * that any adapter can use. Each framework template defines:
 *   - What the agent does (role, capabilities)
 *   - How it connects (framework-specific connection config)
 *   - What permissions it needs (tool scopes)
 *
 * The existing AGENT_TEMPLATES in agent-templates.ts remain for OpenClaw-native
 * use. This module wraps them with a framework-aware registry.
 */

import { AGENT_TEMPLATES, type AgentTemplate } from './agent-templates'
import { listAdapters } from './adapters'

// ─── Framework Connection Config ────────────────────────────────────────────

export interface FrameworkConnectionConfig {
  /** How the agent connects to MC (webhook, polling, websocket) */
  connectionMode: 'webhook' | 'polling' | 'websocket'
  /** Default heartbeat interval in seconds */
  heartbeatInterval: number
  /** Framework-specific setup hints shown in the UI */
  setupHints: string[]
  /** Example connection code snippet */
  exampleSnippet: string
}

export interface FrameworkInfo {
  id: string
  label: string
  description: string
  docsUrl: string
  connection: FrameworkConnectionConfig
}

// ─── Framework Registry ─────────────────────────────────────────────────────

export const FRAMEWORK_REGISTRY: Record<string, FrameworkInfo> = {
  nanobot: {
    id: 'nanobot',
    label: 'nanobot',
    description: 'Observe selected HKUDS/nanobot WebSocket chats through a local bridge',
    docsUrl: 'https://github.com/HKUDS/nanobot',
    connection: {
      connectionMode: 'webhook',
      heartbeatInterval: 30,
      setupHints: [
        'Enable nanobot WebSocket access and configure NANOBOT_WS_URL and NANOBOT_TOKEN',
        'Set MC_API_KEY (operator), a dedicated MC_AGENT_NAME, and explicit NANOBOT_CHAT_IDS',
        'Run node scripts/nanobot-bridge.mjs; see examples/NANOBOT-BRIDGE.md',
        'Observation only: turn completion does not complete a Mission Control task',
      ],
      exampleSnippet: `# Set MC_API_KEY and NANOBOT_TOKEN in your environment first.
MC_URL=http://127.0.0.1:3000 \\
MC_AGENT_NAME=nanobot-personal-monitor \\
NANOBOT_WS_URL=ws://127.0.0.1:8765/ \\
NANOBOT_CHAT_IDS=chat-a,chat-b \\
node scripts/nanobot-bridge.mjs`,
    },
  },
  openclaw: {
    id: 'openclaw',
    label: 'OpenClaw',
    description: 'Native gateway-managed agents with full lifecycle control',
    docsUrl: 'https://github.com/openclaw/openclaw',
    connection: {
      connectionMode: 'websocket',
      heartbeatInterval: 30,
      setupHints: [
        'Agents are managed via the OpenClaw gateway',
        'Config syncs bidirectionally via openclaw.json',
        'Use "pnpm openclaw agents add" to provision',
      ],
      exampleSnippet: `# OpenClaw agents are auto-managed by the gateway.
# No manual registration needed — sync happens automatically.
# See: openclaw.json in your state directory.`,
    },
  },
  generic: {
    id: 'generic',
    label: 'Generic HTTP',
    description: 'Any agent that can make HTTP calls — the universal adapter',
    docsUrl: '',
    connection: {
      connectionMode: 'polling',
      heartbeatInterval: 60,
      setupHints: [
        'POST to /api/adapters with framework: "generic"',
        'Use any language — just call the REST API',
        'Poll /api/adapters for assignments or use SSE for push',
      ],
      exampleSnippet: `# Register your agent
curl -X POST http://localhost:3000/api/adapters \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "framework": "generic",
    "action": "register",
    "payload": {
      "agentId": "my-agent-1",
      "name": "My Custom Agent",
      "metadata": { "version": "1.0" }
    }
  }'

# Send heartbeat
curl -X POST http://localhost:3000/api/adapters \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "framework": "generic",
    "action": "heartbeat",
    "payload": { "agentId": "my-agent-1", "status": "online" }
  }'

# Get assignments
curl -X POST http://localhost:3000/api/adapters \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "framework": "generic",
    "action": "assignments",
    "payload": { "agentId": "my-agent-1" }
  }'`,
    },
  },
  langgraph: {
    id: 'langgraph',
    label: 'LangGraph',
    description: 'LangChain\'s graph-based agent orchestration framework',
    docsUrl: 'https://langchain-ai.github.io/langgraph/',
    connection: {
      connectionMode: 'webhook',
      heartbeatInterval: 30,
      setupHints: [
        'Wrap your LangGraph graph with the MC adapter client',
        'Register nodes as capabilities for task routing',
        'Use checkpointers for durable state across MC task assignments',
      ],
      exampleSnippet: `import requests

MC_URL = "http://localhost:3000"
API_KEY = "YOUR_API_KEY"
HEADERS = {"Content-Type": "application/json", "x-api-key": API_KEY}

# Register your LangGraph agent
requests.post(f"{MC_URL}/api/adapters", headers=HEADERS, json={
    "framework": "langgraph",
    "action": "register",
    "payload": {
        "agentId": "langgraph-research-agent",
        "name": "Research Agent",
        "metadata": {
            "graph_type": "StateGraph",
            "nodes": ["research", "summarize", "review"],
            "checkpointer": "sqlite"
        }
    }
})

# After your graph completes a task:
requests.post(f"{MC_URL}/api/adapters", headers=HEADERS, json={
    "framework": "langgraph",
    "action": "report",
    "payload": {
        "taskId": "task-123",
        "agentId": "langgraph-research-agent",
        "progress": 100,
        "status": "completed",
        "output": {"summary": "Research complete", "sources": 12}
    }
})`,
    },
  },
  crewai: {
    id: 'crewai',
    label: 'CrewAI',
    description: 'Role-based multi-agent orchestration framework',
    docsUrl: 'https://docs.crewai.com/',
    connection: {
      connectionMode: 'webhook',
      heartbeatInterval: 30,
      setupHints: [
        'Register each CrewAI agent role as a separate MC agent',
        'Map Crew tasks to MC task assignments',
        'Use callbacks to report progress back to MC',
      ],
      exampleSnippet: `from crewai import Agent, Task, Crew
import requests

MC_URL = "http://localhost:3000"
HEADERS = {"Content-Type": "application/json", "x-api-key": "YOUR_API_KEY"}

def register_crew_agent(agent: Agent):
    """Register a CrewAI agent with Mission Control."""
    requests.post(f"{MC_URL}/api/adapters", headers=HEADERS, json={
        "framework": "crewai",
        "action": "register",
        "payload": {
            "agentId": f"crewai-{agent.role.lower().replace(' ', '-')}",
            "name": agent.role,
            "metadata": {
                "goal": agent.goal,
                "backstory": agent.backstory[:200],
                "tools": [t.name for t in (agent.tools or [])]
            }
        }
    })

def report_task_complete(agent_id: str, task_id: str, output: str):
    """Report task completion to Mission Control."""
    requests.post(f"{MC_URL}/api/adapters", headers=HEADERS, json={
        "framework": "crewai",
        "action": "report",
        "payload": {
            "taskId": task_id,
            "agentId": agent_id,
            "progress": 100,
            "status": "completed",
            "output": {"result": output}
        }
    })`,
    },
  },
  autogen: {
    id: 'autogen',
    label: 'AutoGen',
    description: 'Microsoft\'s multi-agent conversation framework',
    docsUrl: 'https://microsoft.github.io/autogen/',
    connection: {
      connectionMode: 'webhook',
      heartbeatInterval: 30,
      setupHints: [
        'Register each AutoGen AssistantAgent with MC',
        'Use message hooks to report conversation progress',
        'Map GroupChat rounds to MC task progress updates',
      ],
      exampleSnippet: `import requests
# AutoGen v0.4+ (ag2)
from autogen import AssistantAgent, UserProxyAgent

MC_URL = "http://localhost:3000"
HEADERS = {"Content-Type": "application/json", "x-api-key": "YOUR_API_KEY"}

def register_autogen_agent(agent_name: str, system_message: str):
    """Register an AutoGen agent with Mission Control."""
    requests.post(f"{MC_URL}/api/adapters", headers=HEADERS, json={
        "framework": "autogen",
        "action": "register",
        "payload": {
            "agentId": f"autogen-{agent_name.lower().replace(' ', '-')}",
            "name": agent_name,
            "metadata": {
                "type": "AssistantAgent",
                "system_message_preview": system_message[:200]
            }
        }
    })

# Register your agents
register_autogen_agent("Coder", "You are a coding assistant...")
register_autogen_agent("Reviewer", "You review code for bugs...")`,
    },
  },
  'claude-sdk': {
    id: 'claude-sdk',
    label: 'Claude Agent SDK',
    description: 'Anthropic\'s native agent SDK for building Claude-powered agents',
    docsUrl: 'https://docs.anthropic.com/en/docs/agents/agent-sdk',
    connection: {
      connectionMode: 'webhook',
      heartbeatInterval: 30,
      setupHints: [
        'Register your Claude Agent SDK agent after initialization',
        'Use tool callbacks to report progress to MC',
        'Map agent turns to MC task progress updates',
      ],
      exampleSnippet: `import Anthropic from "@anthropic-ai/sdk";

const MC_URL = "http://localhost:3000";
const HEADERS = { "Content-Type": "application/json", "x-api-key": "YOUR_API_KEY" };

// Register your Claude SDK agent
await fetch(\`\${MC_URL}/api/adapters\`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({
    framework: "claude-sdk",
    action: "register",
    payload: {
      agentId: "claude-agent-1",
      name: "Claude Development Agent",
      metadata: {
        model: "claude-sonnet-4-20250514",
        tools: ["computer", "text_editor", "bash"]
      }
    }
  })
});

// Report task completion
await fetch(\`\${MC_URL}/api/adapters\`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({
    framework: "claude-sdk",
    action: "report",
    payload: {
      taskId: "task-456",
      agentId: "claude-agent-1",
      progress: 100,
      status: "completed",
      output: { files_changed: 3, tests_passed: true }
    }
  })
});`,
    },
  },
}

// ─── Universal Template Archetypes ──────────────────────────────────────────

export interface UniversalTemplate {
  type: string
  label: string
  description: string
  emoji: string
  /** Which frameworks this template supports */
  frameworks: string[]
  /** Role-based capabilities (framework-agnostic) */
  capabilities: string[]
  /** The OpenClaw template to use when framework is openclaw */
  openclawTemplateType?: string
}

/**
 * Universal templates that work across all frameworks.
 * These describe WHAT the agent does, not HOW it's configured.
 * Framework-specific config is resolved at creation time.
 */
export const UNIVERSAL_TEMPLATES: UniversalTemplate[] = [
  {
    type: 'observer',
    label: 'Activity Observer',
    description: 'Reports external agent activity without dispatching or completing tasks.',
    emoji: '👀',
    frameworks: ['generic', 'nanobot'],
    capabilities: ['status_observation'],
  },
  {
    type: 'orchestrator',
    label: 'Orchestrator',
    description: 'Coordinates other agents, routes tasks, and manages workflows. Full access.',
    emoji: '\ud83e\udded',
    frameworks: ['openclaw', 'generic', 'langgraph', 'crewai', 'autogen', 'claude-sdk'],
    capabilities: ['task_routing', 'agent_management', 'workflow_control', 'full_access'],
    openclawTemplateType: 'orchestrator',
  },
  {
    type: 'developer',
    label: 'Developer',
    description: 'Writes and edits code, runs builds and tests. Read-write workspace access.',
    emoji: '\ud83d\udee0\ufe0f',
    frameworks: ['openclaw', 'generic', 'langgraph', 'crewai', 'autogen', 'claude-sdk'],
    capabilities: ['code_write', 'code_execute', 'testing', 'debugging'],
    openclawTemplateType: 'developer',
  },
  {
    type: 'reviewer',
    label: 'Reviewer / QA',
    description: 'Reviews code and validates quality. Read-only access, lightweight model.',
    emoji: '\ud83d\udd2c',
    frameworks: ['openclaw', 'generic', 'langgraph', 'crewai', 'autogen', 'claude-sdk'],
    capabilities: ['code_read', 'quality_review', 'security_audit'],
    openclawTemplateType: 'reviewer',
  },
  {
    type: 'researcher',
    label: 'Researcher',
    description: 'Browses the web and gathers information. No code execution.',
    emoji: '\ud83d\udd0d',
    frameworks: ['openclaw', 'generic', 'langgraph', 'crewai', 'autogen', 'claude-sdk'],
    capabilities: ['web_browse', 'data_gathering', 'summarization'],
    openclawTemplateType: 'researcher',
  },
  {
    type: 'content-creator',
    label: 'Content Creator',
    description: 'Generates and edits written content. No code execution or browsing.',
    emoji: '\u270f\ufe0f',
    frameworks: ['openclaw', 'generic', 'langgraph', 'crewai', 'autogen', 'claude-sdk'],
    capabilities: ['content_write', 'content_edit'],
    openclawTemplateType: 'content-creator',
  },
  {
    type: 'security-auditor',
    label: 'Security Auditor',
    description: 'Scans for vulnerabilities. Read-only with shell access for scanning tools.',
    emoji: '\ud83d\udee1\ufe0f',
    frameworks: ['openclaw', 'generic', 'langgraph', 'crewai', 'autogen', 'claude-sdk'],
    capabilities: ['code_read', 'shell_execute', 'security_scan'],
    openclawTemplateType: 'security-auditor',
  },
]

// ─── Template Resolution ────────────────────────────────────────────────────

/**
 * Get a universal template by type.
 */
export function getUniversalTemplate(type: string): UniversalTemplate | undefined {
  return UNIVERSAL_TEMPLATES.find(t => t.type === type)
}

/**
 * List templates available for a specific framework.
 */
export function getTemplatesForFramework(framework: string): UniversalTemplate[] {
  return UNIVERSAL_TEMPLATES.filter(t => t.frameworks.includes(framework))
}

/**
 * Get framework connection info.
 */
export function getFrameworkInfo(framework: string): FrameworkInfo | undefined {
  return FRAMEWORK_REGISTRY[framework]
}

/**
 * List all supported frameworks.
 */
export function listFrameworks(): FrameworkInfo[] {
  return Object.values(FRAMEWORK_REGISTRY)
}

/**
 * Resolve a universal template to its OpenClaw-specific config (if applicable).
 * For non-OpenClaw frameworks, returns the universal template metadata
 * since config is managed externally by the framework.
 */
export function resolveTemplateConfig(
  universalType: string,
  framework: string
): { template?: AgentTemplate; universal: UniversalTemplate } | undefined {
  const universal = getUniversalTemplate(universalType)
  if (!universal) return undefined
  if (!universal.frameworks.includes(framework)) return undefined

  if (framework === 'openclaw' && universal.openclawTemplateType) {
    const template = AGENT_TEMPLATES.find(t => t.type === universal.openclawTemplateType)
    return { template, universal }
  }

  return { universal }
}
