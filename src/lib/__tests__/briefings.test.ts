import { describe, it, expect } from 'vitest'
import { buildBriefingContent } from '../briefings'
import { markdownToSlack, BRIEFING_CHANNELS, channelForAgent } from '../briefing-slack'
import { isoWeekNumber, buildLandlordReportHtml } from '../briefing-weekly-report'

describe('buildBriefingContent', () => {
  it('renders urgent, calendar, and status sections', () => {
    const content = buildBriefingContent({
      agentName: 'Sofia',
      date: '2026-06-24',
      urgentTasks: [{ id: 1, title: 'Fix leak', description: 'water everywhere' }],
      todayTasks: [{ id: 2, title: 'Call landlord' }],
      tomorrowTasks: [{ id: 3, title: 'Inspect flat' }],
      metrics: { inProgress: 2, assigned: 1, review: 0, completedToday: 3 },
    })
    expect(content).toContain('Morning Briefing — Sofia — 2026-06-24')
    expect(content).toContain('🔴 URGENT')
    expect(content).toContain('Fix leak')
    expect(content).toContain('Call landlord')
    expect(content).toContain('Inspect flat')
    expect(content).toContain('In Progress**: 2')
    expect(content).toContain('Completed Today**: 3')
  })

  it('omits urgent and calendar sections when empty', () => {
    const content = buildBriefingContent({
      agentName: 'James',
      date: '2026-06-24',
      urgentTasks: [],
      todayTasks: [],
      tomorrowTasks: [],
      metrics: { inProgress: 0, assigned: 0, review: 0, completedToday: 0 },
    })
    expect(content).not.toContain('URGENT')
    expect(content).not.toContain('Your Calendar')
    expect(content).toContain('Your Status')
  })
})

describe('markdownToSlack', () => {
  it('converts headings to bold and ** to single asterisk', () => {
    const out = markdownToSlack('# Title\n## Section\n**bold** text\n- item')
    expect(out).toContain('*Title*')
    expect(out).toContain('*Section*')
    expect(out).toContain('*bold* text')
    expect(out).toContain('- item')
    expect(out).not.toContain('##')
    expect(out).not.toContain('**')
  })
})

describe('channel routing', () => {
  it('maps the five domain agents and nothing else', () => {
    expect(channelForAgent('Sofia')).toBe(BRIEFING_CHANNELS.Sofia)
    expect(channelForAgent('James')).toBe(BRIEFING_CHANNELS.James)
    expect(channelForAgent('Victoria')).toBe(BRIEFING_CHANNELS.Victoria)
    expect(channelForAgent('Aria')).toBe(BRIEFING_CHANNELS.Aria)
    expect(channelForAgent('Iris')).toBe(BRIEFING_CHANNELS.Iris)
    expect(channelForAgent('Leo')).toBeNull()
    expect(channelForAgent('Nobody')).toBeNull()
  })

  it('routes Victoria and Aria to the same direct-bookings channel', () => {
    expect(channelForAgent('Victoria')).toBe(channelForAgent('Aria'))
  })
})

describe('isoWeekNumber', () => {
  it('computes ISO week numbers', () => {
    expect(isoWeekNumber(new Date('2026-01-01T00:00:00Z'))).toBe(1)
    expect(isoWeekNumber(new Date('2026-06-24T00:00:00Z'))).toBe(26)
  })
})

describe('buildLandlordReportHtml', () => {
  const incidents = [
    {
      property_id: 'Pimlico',
      title: 'Water leak',
      description: 'Kitchen pipe',
      category: 'maintenance',
      severity: 'high',
      status: 'resolved',
      resolved_date: Math.floor(new Date('2026-06-20T00:00:00Z').getTime() / 1000),
      cost: 180,
      guest_sentiment: 'negative',
      guest_impact_score: 8,
    },
  ]

  it('includes property, cost total, and resolved item — landlord-safe', () => {
    const html = buildLandlordReportHtml({
      propertyId: 'Pimlico',
      weekNo: 26,
      year: 2026,
      rangeLabel: '2026-06-17 – 2026-06-24',
      incidents,
    })
    expect(html).toContain('Pimlico')
    expect(html).toContain('Week 26')
    expect(html).toContain('£180.00')
    expect(html).toContain('Water leak')
    // Landlord-safe: no internal-only fields leaked into the HTML.
    expect(html).not.toContain('assigned_to')
    expect(html).not.toContain('conflicts')
    expect(html).not.toContain('guest_impact_score')
  })

  it('escapes HTML in user-supplied fields', () => {
    const html = buildLandlordReportHtml({
      propertyId: '<script>x</script>',
      weekNo: 1,
      year: 2026,
      rangeLabel: 'r',
      incidents: [],
    })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
