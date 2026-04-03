'use client'

import type { SessionSlice } from './slices/session-slice'
import type { AgentSlice } from './slices/agent-slice'
import type { TaskSlice } from './slices/task-slice'
import type { LogSlice } from './slices/log-slice'
import type { ModelSlice } from './slices/model-slice'
import type { UiSlice } from './slices/ui-slice'
import type { ChatSlice } from './slices/chat-slice'
import type { TenantSlice } from './slices/tenant-slice'

// RootStore is the full combined store type across all domain slices
export type RootStore =
  & SessionSlice
  & AgentSlice
  & TaskSlice
  & LogSlice
  & ModelSlice
  & UiSlice
  & ChatSlice
  & TenantSlice
