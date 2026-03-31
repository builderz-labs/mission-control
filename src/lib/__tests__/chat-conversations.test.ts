import { describe, expect, it } from 'vitest'
import {
  bucketConversations,
  buildConversationIndex,
  filterConversations,
  getSessionConversationId,
  limitConversationBuckets,
  type ChatSessionRecord,
} from '@/lib/chat-conversations'

function makeGatewaySession(id: string, overrides: Partial<ChatSessionRecord> = {}): ChatSessionRecord {
  return {
    id,
    key: `agent:main:${id}`,
    agent: 'main',
    kind: 'gateway',
    source: 'gateway',
    model: 'k2p5',
    tokens: '10k/262k',
    active: true,
    lastActivity: 1_712_345_600,
    ...overrides,
  }
}

describe('chat-conversations', () => {
  it('merges persisted session conversation data onto session-backed rows', () => {
    const conversationId = getSessionConversationId('gateway', 'abc')
    const rows = buildConversationIndex({
      sessions: [makeGatewaySession('abc')],
      prefs: {},
      persisted: [{
        conversation_id: conversationId,
        unread_count: 2,
        last_message_at: 1_712_345_999,
        last_message: {
          id: 17,
          from_agent: 'human',
          to_agent: 'main',
          content: 'hello',
          message_type: 'text',
          created_at: 1_712_345_999,
        },
      }],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(conversationId)
    expect(rows[0].unreadCount).toBe(2)
    expect(rows[0].lastMessage?.content).toBe('hello')
    expect(rows[0].updatedAt).toBe(1_712_345_999)
  })

  it('keeps non-session persisted conversations alongside session rows', () => {
    const rows = buildConversationIndex({
      sessions: [makeGatewaySession('abc')],
      prefs: {},
      persisted: [{
        conversation_id: 'agent_selector',
        unread_count: 1,
        last_message_at: 1_712_346_000,
        last_message: {
          id: 19,
          from_agent: 'selector',
          to_agent: 'human',
          content: 'status update',
          message_type: 'text',
          created_at: 1_712_346_000,
        },
      }],
    })

    expect(rows).toHaveLength(2)
    expect(rows.some((row) => row.id === 'agent_selector')).toBe(true)
    expect(rows.find((row) => row.id === 'agent_selector')?.name).toBe('selector')
    expect(rows.find((row) => row.id === 'agent_selector')?.lastMessage?.content).toBe('status update')
  })

  it('prefers saved display names for session rows', () => {
    const rows = buildConversationIndex({
      sessions: [makeGatewaySession('abc')],
      prefs: {
        'gateway:abc': { name: 'HH main', color: 'blue' },
      },
      persisted: [],
    })

    expect(rows[0].name).toBe('HH main')
    expect(rows[0].session?.displayName).toBe('HH main')
    expect(rows[0].session?.colorTag).toBe('blue')
  })

  it('keeps non-session conversations in a separate rendered bucket', () => {
    const rows = buildConversationIndex({
      sessions: [makeGatewaySession('abc')],
      prefs: {},
      persisted: [{
        conversation_id: 'agent_selector',
        unread_count: 1,
        last_message_at: 1_712_346_000,
        last_message: {
          id: 19,
          from_agent: 'selector',
          to_agent: 'human',
          content: 'status update',
          message_type: 'text',
          created_at: 1_712_346_000,
        },
      }],
    })

    const buckets = bucketConversations(rows)
    expect(buckets.activeGatewayRows).toHaveLength(1)
    expect(buckets.otherRows).toHaveLength(1)
    expect(buckets.otherRows[0].id).toBe('agent_selector')
  })

  it('filters conversations across names and last messages', () => {
    const rows = buildConversationIndex({
      sessions: [makeGatewaySession('abc')],
      prefs: {},
      persisted: [{
        conversation_id: 'agent_selector',
        unread_count: 1,
        last_message_at: 1_712_346_000,
        last_message: {
          id: 19,
          from_agent: 'selector',
          to_agent: 'human',
          content: 'status update',
          message_type: 'text',
          created_at: 1_712_346_000,
        },
      }],
    })

    expect(filterConversations(rows, 'selector')).toHaveLength(1)
    expect(filterConversations(rows, 'status update')).toHaveLength(1)
    expect(filterConversations(rows, 'gateway')).toHaveLength(1)
  })

  it('limits inactive lists by default but preserves all rows when expanded', () => {
    const rows = buildConversationIndex({
      sessions: [
        makeGatewaySession('active-a', { active: true }),
        ...Array.from({ length: 15 }, (_, index) => makeGatewaySession(`recent-${index}`, { active: false })),
      ],
      prefs: {},
      persisted: [],
    })

    const buckets = bucketConversations(rows)
    const limited = limitConversationBuckets(buckets)
    const expanded = limitConversationBuckets(buckets, { expandInactiveGateway: true })

    expect(limited.inactiveGatewayRows).toHaveLength(12)
    expect(limited.hiddenInactiveGatewayCount).toBe(3)
    expect(expanded.inactiveGatewayRows).toHaveLength(15)
    expect(expanded.hiddenInactiveGatewayCount).toBe(0)
  })
})
