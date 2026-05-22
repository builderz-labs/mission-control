/**
 * Phase 6 BUILD — adaptGatewayUsage edge-case tests (D18 checklist).
 *
 * Covers: retries, streaming, tool_use (sub-attribution), cached tokens,
 * model aliases, failed requests, missing fields.
 */
import { describe, it, expect } from 'vitest'
import { adaptGatewayUsage } from '../gateway-usage-adapter'

describe('adaptGatewayUsage — Phase 6 D18 edge cases', () => {
  describe('shape detection', () => {
    it('returns null when no model is supplied', () => {
      expect(adaptGatewayUsage({ usage: { input_tokens: 1, output_tokens: 1 } }, 'sess_1')).toBeNull()
    })

    it('returns null when neither MC-native nor gateway-native fields present', () => {
      expect(adaptGatewayUsage({ model: 'anthropic/claude-sonnet-4-5' }, 'sess_1')).toBeNull()
    })

    it('returns null when sessionId missing AND no fallback', () => {
      expect(
        adaptGatewayUsage(
          { model: 'anthropic/claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 5 } },
          '',
        ),
      ).toBeNull()
    })
  })

  describe('native MC shape passthrough', () => {
    it('preserves explicit cost when upstream provides it', () => {
      const result = adaptGatewayUsage(
        {
          type: 'token_usage',
          model: 'anthropic/claude-sonnet-4-5',
          sessionId: 'sess_1',
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          cost: 0.012,
        },
        'fallback',
      )
      expect(result).not.toBeNull()
      expect(result!.cost).toBe(0.012)
      expect(result!.sessionId).toBe('sess_1')
      expect(result!.inputTokens).toBe(1000)
    })

    it('derives totalTokens when omitted', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          sessionId: 'sess_1',
          inputTokens: 200,
          outputTokens: 100,
        },
        'fallback',
      )
      expect(result!.totalTokens).toBe(300)
    })
  })

  describe('gateway-native shape (D18: streaming + standard)', () => {
    it('adapts snake_case usage block + computes cost via pricing table', () => {
      const result = adaptGatewayUsage(
        {
          type: 'token_usage',
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_xyz',
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
        'fallback',
      )
      expect(result).not.toBeNull()
      // Sonnet 4.5: $3/MTok input + $15/MTok output
      // (1000 * 3 + 500 * 15) / 1_000_000 = (3000 + 7500) / 1M = 0.0105
      expect(result!.cost).toBeCloseTo(0.0105, 4)
      expect(result!.sessionId).toBe('sess_xyz')
    })

    it('falls back to fallbackSessionId when frame omits both session_id keys', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        'fallback_sess',
      )
      expect(result!.sessionId).toBe('fallback_sess')
    })
  })

  describe('D18: cached tokens', () => {
    it('counts cache_creation + cache_read as additional input tokens', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_1',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
          },
        },
        'fb',
      )
      expect(result!.inputTokens).toBe(1500) // 1000 + 200 + 300
      expect(result!.cacheCreationTokens).toBe(200)
      expect(result!.cacheReadTokens).toBe(300)
      expect(result!.totalTokens).toBe(2000) // 1500 + 500
    })

    it('omits cache fields from output when zero', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_1',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        'fb',
      )
      expect(result!.cacheCreationTokens).toBeUndefined()
      expect(result!.cacheReadTokens).toBeUndefined()
    })
  })

  describe('D18: tool_use sub-attribution', () => {
    it('preserves agent name + task_id when present', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_1',
          usage: { input_tokens: 100, output_tokens: 50 },
          agent: 'researcher-subagent',
          task_id: 'task_42',
        },
        'fb',
      )
      expect(result!.agentName).toBe('researcher-subagent')
      expect(result!.taskId).toBe('task_42')
    })

    it('accepts both camelCase and snake_case for agent/task fields', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          sessionId: 'sess_1',
          inputTokens: 100,
          outputTokens: 50,
          agentName: 'orchestrator',
          taskId: 'task_99',
        },
        'fb',
      )
      expect(result!.agentName).toBe('orchestrator')
      expect(result!.taskId).toBe('task_99')
    })
  })

  describe('D18: model aliases', () => {
    it('resolves short alias `claude-sonnet-4-5` to sonnet 4.5 pricing', () => {
      const result = adaptGatewayUsage(
        {
          model: 'claude-sonnet-4-5',
          session_id: 'sess_1',
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
        'fb',
      )
      // Should match either anthropic/claude-sonnet-4-5 or claude-sonnet-4-5 entry
      expect(result!.cost).toBeCloseTo(0.0105, 4)
    })

    it('falls back to default pricing for unknown model', () => {
      const result = adaptGatewayUsage(
        {
          model: 'unknown-model-xyz',
          session_id: 'sess_1',
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
        'fb',
      )
      // Default: $3 input + $15 output per MTok → same math
      expect(result!.cost).toBeCloseTo(0.0105, 4)
    })
  })

  describe('D18: failed requests', () => {
    it('emits row with cost=0 when both token counts are zero', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_failed',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        'fb',
      )
      expect(result).not.toBeNull()
      expect(result!.cost).toBe(0)
      expect(result!.totalTokens).toBe(0)
    })

    it('handles partial frames (input_tokens only, no output) — incomplete stream', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_1',
          usage: { input_tokens: 1000, output_tokens: 0 },
        },
        'fb',
      )
      expect(result!.inputTokens).toBe(1000)
      expect(result!.outputTokens).toBe(0)
      // 1000 input * $3/MTok = $0.003
      expect(result!.cost).toBeCloseTo(0.003, 4)
    })
  })

  describe('D18: retries', () => {
    it('is pure — same input always produces same output (caller dedupes via request_id)', () => {
      const a = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_1',
          request_id: 'req_1',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        'fb',
      )
      const b = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_1',
          request_id: 'req_1',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        'fb',
      )
      expect(a).toEqual(b)
    })
  })

  describe('defensive parsing', () => {
    it('floors negative values to 0', () => {
      const result = adaptGatewayUsage(
        {
          model: 'anthropic/claude-sonnet-4-5',
          session_id: 'sess_1',
          usage: { input_tokens: -50, output_tokens: 100 },
        },
        'fb',
      )
      expect(result!.inputTokens).toBe(0)
      expect(result!.outputTokens).toBe(100)
    })
  })
})
