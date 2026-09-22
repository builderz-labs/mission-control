import { describe, expect, it } from 'vitest'
import { JEV_ASSISTANT_SYSTEM_PROMPT } from '@/lib/jev-assistant-prompt'

describe('Jev assistant semantic guidance', () => {
  it('distinguishes ordinal anchors from unrelated dimensions and numeric output instructions', () => {
    expect(JEV_ASSISTANT_SYSTEM_PROMPT).toContain('one dimension per question')
    expect(JEV_ASSISTANT_SYSTEM_PROMPT).toContain('compliance are NOT score levels')
    expect(JEV_ASSISTANT_SYSTEM_PROMPT).toContain('Never request multiple scores inside one Score question')
    expect(JEV_ASSISTANT_SYSTEM_PROMPT).toContain('Do not prefix levels with numbers')
  })
})
