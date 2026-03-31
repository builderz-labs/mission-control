import { describe, expect, it } from 'vitest'
import { buildRuntimeTaskOverview } from '@/lib/runtime-task-overview'

describe('buildRuntimeTaskOverview', () => {
  it('summarizes HH runtime tasks with reserved slots and failures', () => {
    const overview = buildRuntimeTaskOverview({
      id: -1002,
      title: '업무02 Holy Hedgehog 일일 배치',
      status: 'review',
      assigned_to: 'hh-ops',
      metadata: {
        runtimeDerived: true,
        runtimeSource: 'hh_daily_status',
        reservedToday: 1,
        publishedToday: 1,
        quotaTarget: 3,
        availableSlots: ['2026-03-29T17:00:00+09:00', '2026-03-29T20:00:00+09:00'],
        failures: ['affiliate_fail'],
      },
    } as any)

    expect(overview.summary).toBe('완료 2/3, 남은 슬롯 2개')
    expect(overview.facts).toContain('게시 1건')
    expect(overview.facts).toContain('예약 1건')
    expect(overview.facts).toContain('남은 슬롯: 17:00, 20:00')
    expect(overview.facts).toContain('실패: affiliate_fail')
    expect(overview.tone).toBe('danger')
  })

  it('shows full HH quota completion when published and reserved slots reach target', () => {
    const overview = buildRuntimeTaskOverview({
      id: -1002,
      title: '업무02 Holy Hedgehog 일일 배치',
      status: 'done',
      assigned_to: 'hh-ops',
      metadata: {
        runtimeDerived: true,
        runtimeSource: 'hh_daily_status',
        reservedToday: 2,
        publishedToday: 1,
        quotaTarget: 3,
        availableSlots: [],
        failures: [],
      },
    } as any)

    expect(overview.summary).toBe('완료 3/3, 남은 슬롯 0개')
    expect(overview.facts).toContain('게시 1건')
    expect(overview.facts).toContain('예약 2건')
    expect(overview.tone).toBe('good')
  })

  it('summarizes growth runtime tasks with per-platform transport state', () => {
    const overview = buildRuntimeTaskOverview({
      id: -1003,
      title: '업무03 growth-ops 업로더 상태',
      status: 'review',
      assigned_to: 'growth-ops',
      metadata: {
        runtimeDerived: true,
        runtimeSource: 'growth_uploads',
        youtubeStatus: 'completed',
        xStatus: 'failed',
        youtubeSlug: 'dyson-supersonic-nural-review',
        xSlug: 'dyson-supersonic-nural-review',
        youtubeNote: 'YouTube CDP fallback attached the file, filled metadata, and saved a private draft.',
        youtubeTransport: 'manual_pending',
        youtubeApprovalStatus: 'approval_required',
        xNote: 'Task failed. compose page rendering problem.',
        xTransport: 'manual_pending',
        xApprovalStatus: 'approval_required',
      },
    } as any)

    expect(overview.summary).toBe('YouTube private draft ready / X retry needed')
    expect(overview.facts).toContain('YouTube: dyson-supersonic-nural-review')
    expect(overview.facts).toContain('YouTube 경로: manual_pending · approval_required')
    expect(overview.facts).toContain('X 이슈: Task failed.')
    expect(overview.tone).toBe('danger')
  })

  it('does not report overdue or dry-run news state as a recent successful send', () => {
    const overdue = buildRuntimeTaskOverview({
      id: -1001,
      title: '업무01 미국 주식 뉴스 15:00 전송',
      status: 'awaiting_owner',
      assigned_to: 'news-ops',
      metadata: {
        runtimeDerived: true,
        runtimeSource: 'daily_us_stock_news',
        latestRunAt: '2026-03-28T15:00:05+09:00',
        sendSuccess: true,
        dryRun: false,
        articleCount: 14,
      },
    } as any)

    const dryRun = buildRuntimeTaskOverview({
      id: -1001,
      title: '업무01 미국 주식 뉴스 15:00 전송',
      status: 'assigned',
      assigned_to: 'news-ops',
      metadata: {
        runtimeDerived: true,
        runtimeSource: 'daily_us_stock_news',
        latestRunAt: '2026-03-29T14:55:00+09:00',
        sendSuccess: true,
        dryRun: true,
        articleCount: 14,
      },
    } as any)

    expect(overdue.summary).toBe('전송 필요/실패')
    expect(dryRun.summary).toBe('드라이런만 완료')
    expect(overdue.facts).toContain('기사 14건')
  })
})
