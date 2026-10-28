import { describe, expect, it } from 'vitest'
import { SOCIAL_CHANNELS } from './social-metrics'
import { getSocialConnectorProfile, socialConnectorRegistry } from './social-connectors'

describe('social connector registry', () => {
  it('covers every canonical organic social channel without pretending credentials exist', () => {
    expect(socialConnectorRegistry).toHaveLength(SOCIAL_CHANNELS.length)
    for (const channel of SOCIAL_CHANNELS) {
      const profile = getSocialConnectorProfile(channel)
      expect(profile.preferred_source).toBe('official_api')
      expect(profile.current_readiness).toBe(['instagram', 'tiktok', 'linkedin', 'x', 'reddit'].includes(channel) ? 'READY_FOR_CREDENTIALS' : 'MANUAL_OR_EXPORT')
      expect(profile.credential_requirements.length).toBeGreaterThan(0)
    }
  })

  it('keeps ad-only open-source connectors out of the organic source-of-truth path', () => {
    expect(getSocialConnectorProfile('tiktok').open_source_candidates.every((item) => item.adoption === 'HOLD')).toBe(true)
    expect(getSocialConnectorProfile('linkedin').open_source_candidates.every((item) => item.adoption === 'HOLD')).toBe(true)
    expect(getSocialConnectorProfile('instagram').open_source_candidates[0]?.adoption).toBe('CANDIDATE')
  })
})
