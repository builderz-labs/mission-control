import type { StateCreator } from 'zustand'
import type { ChatMessage, Conversation } from '../types'

export interface ChatSlice {
  chatMessages: ChatMessage[]
  conversations: Conversation[]
  activeConversation: string | null
  chatInput: string
  isSendingMessage: boolean
  chatPanelOpen: boolean
  setChatMessages: (messages: ChatMessage[]) => void
  addChatMessage: (message: ChatMessage) => void
  replacePendingMessage: (tempId: number, message: ChatMessage) => void
  updatePendingMessage: (tempId: number, updates: Partial<ChatMessage>) => void
  removePendingMessage: (tempId: number) => void
  setConversations: (conversations: Conversation[]) => void
  setActiveConversation: (conversationId: string | null) => void
  setChatInput: (input: string) => void
  setIsSendingMessage: (loading: boolean) => void
  setChatPanelOpen: (open: boolean) => void
  markConversationRead: (conversationId: string) => void
}

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set) => ({
  chatMessages: [],
  conversations: [],
  activeConversation: null,
  chatInput: '',
  isSendingMessage: false,
  chatPanelOpen: false,
  setChatMessages: (messages) => set({ chatMessages: messages.slice(-500) }),
  addChatMessage: (message) =>
    set((state) => {
      if (message.id > 0 && state.chatMessages.some(m => m.id === message.id)) {
        return state
      }
      const messages = [...state.chatMessages, message].slice(-500)
      const conversations = state.conversations.map((conv) =>
        conv.id === message.conversation_id
          ? { ...conv, lastMessage: message, updatedAt: message.created_at }
          : conv
      )
      return { chatMessages: messages, conversations }
    }),
  replacePendingMessage: (tempId, message) =>
    set((state) => ({
      chatMessages: state.chatMessages.map(m =>
        m.id === tempId ? { ...message, pendingStatus: 'sent' as const } : m
      ),
    })),
  updatePendingMessage: (tempId, updates) =>
    set((state) => ({
      chatMessages: state.chatMessages.map(m =>
        m.id === tempId ? { ...m, ...updates } : m
      ),
    })),
  removePendingMessage: (tempId) =>
    set((state) => ({
      chatMessages: state.chatMessages.filter(m => m.id !== tempId),
    })),
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (conversationId) => set({ activeConversation: conversationId }),
  setChatInput: (input) => set({ chatInput: input }),
  setIsSendingMessage: (loading) => set({ isSendingMessage: loading }),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  markConversationRead: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? { ...conv, unreadCount: 0 }
          : conv
      ),
      chatMessages: state.chatMessages.map((msg) =>
        msg.conversation_id === conversationId && !msg.read_at
          ? { ...msg, read_at: Math.floor(Date.now() / 1000) }
          : msg
      )
    })),
})
