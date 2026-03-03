/**
 * Gateway abstraction layer — public API.
 *
 * Re-exports types, registry, and registers built-in adapters.
 */

export type {
  GatewayType,
  GatewayConfig,
  GatewayStatus,
  GatewaySession,
  GatewayLogEntry,
  GatewayAdapter,
  GatewayCapabilities,
  SpawnRequest,
  SpawnResult,
} from './types'

export {
  registerAdapter,
  createAdapter,
  hasAdapter,
  getRegisteredTypes,
  getAdapterInfo,
} from './registry'

export { CustomGatewayAdapter } from './adapters/custom-adapter'

// ── Register built-in adapters ──────────────────────

import { registerAdapter } from './registry'
import { CustomGatewayAdapter } from './adapters/custom-adapter'

// OpenClaw adapter is the existing WebSocket-based connection in websocket.ts.
// It is not refactored here to avoid breaking the current codebase.
// Instead, we register the "openclaw" type as an alias for the default behavior.
// The custom adapter covers all new non-OpenClaw backends.

registerAdapter('custom', () => new CustomGatewayAdapter())

// Future adapters can be registered here:
// registerAdapter('langgraph', () => new LangGraphAdapter())
// registerAdapter('crewai', () => new CrewAIAdapter())
// registerAdapter('autogen', () => new AutoGenAdapter())
