import { describe, expect, it } from 'vitest'
import { prepareDoctorBannerCopy } from '@/lib/doctor-banner-copy'

describe('prepareDoctorBannerCopy', () => {
  it('removes duplicate, empty, and bullet-prefixed issues', () => {
    expect(prepareDoctorBannerCopy(
      'Gateway service PATH missing required dirs:',
      ['- Gateway service PATH missing required dirs:', ' ', '• Restart the gateway', '* Restart the gateway'],
    )).toEqual({
      summary: 'Gateway service PATH missing required dirs',
      issues: ['Restart the gateway'],
    })
  })

  it('provides useful copy when the summary is empty', () => {
    expect(prepareDoctorBannerCopy('', [])).toEqual({
      summary: 'OpenClaw reported an issue',
      issues: [],
    })
  })
})
