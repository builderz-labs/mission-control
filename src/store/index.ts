'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { devtools } from 'zustand/middleware'

import { createSessionSlice } from './slices/session-slice'
import { createAgentSlice } from './slices/agent-slice'
import { createTaskSlice } from './slices/task-slice'
import { createLogSlice } from './slices/log-slice'
import { createModelSlice } from './slices/model-slice'
import { createUiSlice } from './slices/ui-slice'
import { createChatSlice } from './slices/chat-slice'
import { createTenantSlice } from './slices/tenant-slice'

import type { RootStore } from './types'

// Re-export all public types so that consumers importing from '@/store' are unaffected
export type { JsonPrimitive, JsonValue, ConnectionStatus } from './shared-types'
export type { Session } from './slices/session-slice'
export type { LogEntry, CronJob, MemoryFile } from './slices/log-slice'
export type { SpawnRequest, Agent } from './slices/agent-slice'
export type { TokenUsage, ModelConfig } from './slices/model-slice'
export type {
  Task,
  Activity,
  Notification,
  Comment,
  StandupReport,
  ExecApprovalRequest,
} from './slices/task-slice'
export type { ChatAttachment, ChatMessage, Conversation } from './slices/chat-slice'
export type { CurrentUser, Tenant, OsUser, Project } from './slices/tenant-slice'

export type { RootStore }

// useMissionControl is the single Zustand store that composes all domain slices.
// devtools middleware enables Redux DevTools inspection in the browser.
export const useMissionControl = create<RootStore>()(
  subscribeWithSelector(
    devtools(
      (...a) => ({
        ...createSessionSlice(...a),
        ...createAgentSlice(...a),
        ...createTaskSlice(...a),
        ...createLogSlice(...a),
        ...createModelSlice(...a),
        ...createUiSlice(...a),
        ...createChatSlice(...a),
        ...createTenantSlice(...a),
      }),
      { name: 'ultron-store' }
    )
  )
)
