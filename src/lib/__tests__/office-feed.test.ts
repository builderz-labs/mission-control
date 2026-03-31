import { describe, expect, it } from 'vitest'
import {
  buildStatusTransitionEvents,
  buildCronJobEvents,
  buildRuntimeTaskEvents,
  mapActivitiesToOfficeEvents,
  mergeOfficeEvents,
  type OfficeFeedActivity,
  type OfficeFeedEvent,
} from '@/lib/office-feed'

describe('office-feed', () => {
  it('maps recent activity rows into deterministic office events', () => {
    const activities: OfficeFeedActivity[] = [
      {
        id: 12,
        type: 'task_completed',
        actor: 'codex',
        description: 'Completed HH publishing batch',
        created_at: 1711800000,
      },
      {
        id: 9,
        type: 'agent_registered',
        actor: 'openclaw',
        description: 'Registered agent growth-ops',
        created_at: 1711799000,
      },
      {
        id: 7,
        type: 'agent_status_change',
        actor: 'heartbeat',
        description: '',
        created_at: 1711798000,
      },
    ]

    const events = mapActivitiesToOfficeEvents(activities)

    expect(events).toEqual([
      {
        id: 'activity-12',
        kind: 'action',
        severity: 'good',
        message: 'codex: Completed HH publishing batch',
        at: 1711800000 * 1000,
      },
      {
        id: 'activity-9',
        kind: 'action',
        severity: 'info',
        message: 'openclaw: Registered agent growth-ops',
        at: 1711799000 * 1000,
      },
    ])
  })

  it('builds deterministic events from runtime tasks and cron jobs', () => {
    expect(buildRuntimeTaskEvents([
      {
        id: -1002,
        title: '업무02 Holy Hedgehog 일일 배치',
        status: 'done',
        updated_at: 1711802000,
        created_by: 'runtime-sync',
        metadata: { runtimeDerived: true },
      },
      {
        id: 14,
        title: 'Regular task',
        status: 'done',
        updated_at: 1711801000,
        created_by: 'alice',
      },
    ])).toEqual([
      {
        id: 'runtime-task--1002-1711802000-done',
        kind: 'desk',
        severity: 'good',
        message: '업무02 Holy Hedgehog 일일 배치: completed.',
        at: 1711802000 * 1000,
      },
    ])

    expect(buildCronJobEvents([
      {
        id: 'launchd-hh-followup-1700',
        name: 'Holy Hedgehog - Follow-up 5PM',
        lastRun: 1711804000000,
        lastStatus: 'error',
        lastError: 'selector_failure',
      },
      {
        id: 'launchd-daily-us-stock-news',
        name: 'Daily US Stock News',
        lastRun: 1711805000000,
        lastStatus: 'success',
      },
    ])).toEqual([
      {
        id: 'cron-launchd-hh-followup-1700-1711804000000-error',
        kind: 'room',
        severity: 'warn',
        message: 'Holy Hedgehog - Follow-up 5PM: failed. (selector_failure)',
        at: 1711804000000,
      },
      {
        id: 'cron-launchd-daily-us-stock-news-1711805000000-success',
        kind: 'room',
        severity: 'good',
        message: 'Daily US Stock News: completed.',
        at: 1711805000000,
      },
    ])
  })

  it('builds status transition events only for actual changes', () => {
    const events = buildStatusTransitionEvents(
      new Map([
        [1, 'idle'],
        [2, 'busy'],
      ]),
      [
        { id: 1, name: 'codex', zoneLabel: 'Engine Bay', status: 'busy' },
        { id: 2, name: 'hermes', zoneLabel: 'Ops Deck', status: 'busy' },
      ],
      1711801000000
    )

    expect(events).toEqual([
      {
        id: 'status-1-busy-1711801000000',
        kind: 'room',
        severity: 'good',
        message: 'Engine Bay: codex status changed to active.',
        at: 1711801000000,
      },
    ])
  })

  it('deduplicates and sorts office events newest-first', () => {
    const existing: OfficeFeedEvent[] = [
      { id: 'a', kind: 'action', severity: 'info', message: 'old', at: 1000 },
    ]
    const next: OfficeFeedEvent[] = [
      { id: 'b', kind: 'room', severity: 'good', message: 'new', at: 3000 },
      { id: 'a', kind: 'action', severity: 'info', message: 'old', at: 1000 },
      { id: 'c', kind: 'action', severity: 'warn', message: 'mid', at: 2000 },
    ]

    expect(mergeOfficeEvents(existing, next, 3).map((event) => event.id)).toEqual(['b', 'c', 'a'])
  })
})
