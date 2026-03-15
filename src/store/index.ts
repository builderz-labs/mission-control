'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createSessionSlice, type SessionSlice } from './slices/session-slice'
import { createAgentSlice, type AgentSlice } from './slices/agent-slice'
import { createTaskSlice, type TaskSlice } from './slices/task-slice'
import { createChatSlice, type ChatSlice } from './slices/chat-slice'
import { createNotificationSlice, type NotificationSlice } from './slices/notification-slice'
import { createUISlice, type UISlice } from './slices/ui-slice'

// Re-export all types for backward compatibility
export * from './types'

// Re-export slice types
export type { SessionSlice } from './slices/session-slice'
export type { AgentSlice } from './slices/agent-slice'
export type { TaskSlice } from './slices/task-slice'
export type { ChatSlice } from './slices/chat-slice'
export type { NotificationSlice } from './slices/notification-slice'
export type { UISlice } from './slices/ui-slice'

export type MissionControlStore = SessionSlice & AgentSlice & TaskSlice & ChatSlice & NotificationSlice & UISlice

export const useMissionControl = create<MissionControlStore>()(
  subscribeWithSelector((...a) => ({
    ...createSessionSlice(...a),
    ...createAgentSlice(...a),
    ...createTaskSlice(...a),
    ...createChatSlice(...a),
    ...createNotificationSlice(...a),
    ...createUISlice(...a),
  }))
)
