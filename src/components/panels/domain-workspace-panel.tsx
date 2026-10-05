'use client'

import { useEffect, useMemo, useState } from 'react'
import { type JsonValue, type Task, useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'

type Domain = 'marketing' | 'development'
type SocialChannel = 'instagram' | 'tiktok' | 'linkedin' | 'x' | 'threads'

interface SocialRollup {
  channel: SocialChannel
  snapshots: number
  unique_posts: number
  latest_captured_at: number
  views: number
  impressions: number
  reach: number
  profile_visits: number
  link_clicks: number
  website_visits: number
  website_unique_visitors: number
  likes: number
  comments: number
  shares: number
  saves: number
  follows: number
  signup: number
  activation: number
  conversion: number
  ctr: number | null
  click_to_visit_rate: number | null
  visitor_to_signup_rate: number | null
  signup_conversion: number | null
  activation_conversion: number | null
}

const SOCIAL_CHANNELS: SocialChannel[] = ['instagram', 'tiktok', 'linkedin', 'x', 'threads']
const nf = new Intl.NumberFormat('ko-KR')

function meta(value: JsonValue | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

function textMeta(task: Task, key: string): string | null {
  const value = meta(task.metadata)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function belongsToDomain(task: Task, domain: Domain): boolean {
  if (textMeta(task, 'domain') === domain) return true
  return task.tags?.includes(domain) === true
}

function statusTone(status: Task['status']): string {
  if (status === 'done') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-400'
  if (status === 'review' || status === 'quality_review' || status === 'awaiting_owner') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
  }
  if (status === 'in_progress') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-500'
  return 'border-border bg-muted/30 text-muted-foreground'
}

const DOMAIN_COPY: Record<Domain, {
  title: string
  subtitle: string
  empty: string
}> = {
  marketing: {
    title: 'Marketing',
    subtitle: '콘텐츠 검수부터 제작, 게시, 측정까지 프로젝트별 마케팅 흐름을 한 곳에서 봅니다.',
    empty: '아직 Marketing 태그/metadata가 붙은 작업이 없습니다.',
  },
  development: {
    title: 'Development',
    subtitle: '구현, 테스트, 수정, 빌드, 배포 승인까지 개발 작업의 현재 상태를 봅니다.',
    empty: '아직 Development 태그/metadata가 붙은 작업이 없습니다.',
  },
}

function pct(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function DomainWorkspacePanel({ domain }: { domain: Domain }) {
  const { tasks, projects, setSelectedTask } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [socialRollups, setSocialRollups] = useState<SocialRollup[]>([])
  const [socialLoading, setSocialLoading] = useState(false)

  useEffect(() => {
    if (domain !== 'marketing') return
    let cancelled = false
    setSocialLoading(true)
    fetch('/api/marketing/social-metrics')
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('social metrics unavailable')))
      .then((data: { rollups?: SocialRollup[] }) => {
        if (!cancelled) setSocialRollups(Array.isArray(data.rollups) ? data.rollups : [])
      })
      .catch(() => {
        if (!cancelled) setSocialRollups([])
      })
      .finally(() => {
        if (!cancelled) setSocialLoading(false)
      })
    return () => { cancelled = true }
  }, [domain])

  const domainTasks = useMemo(
    () => tasks
      .filter((task) => belongsToDomain(task, domain))
      .sort((a, b) => b.updated_at - a.updated_at),
    [tasks, domain],
  )

  const counts = useMemo(() => ({
    approvals: domainTasks.filter((t) => ['awaiting_owner', 'review', 'quality_review'].includes(t.status)).length,
    running: domainTasks.filter((t) => t.status === 'in_progress' || t.status === 'assigned').length,
    failed: domainTasks.filter((t) => t.status === 'failed').length,
    done: domainTasks.filter((t) => t.status === 'done').length,
  }), [domainTasks])

  const socialByChannel = useMemo(
    () => new Map(socialRollups.map((item) => [item.channel, item])),
    [socialRollups],
  )

  const copy = DOMAIN_COPY[domain]

  function openTask(task: Task) {
    setSelectedTask(task)
    navigateToPanel('tasks')
  }

  return (
    <div className="p-5 space-y-5">
      <section className="rounded-2xl border border-border bg-card px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">AI Ops Hub</div>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">{copy.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{copy.subtitle}</p>
          </div>
          <Button variant="outline" onClick={() => navigateToPanel('tasks')}>Task Board 열기</Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['승인 대기', counts.approvals, 'text-amber-500'],
            ['진행 중', counts.running, 'text-cyan-500'],
            ['실패/막힘', counts.failed, 'text-red-400'],
            ['완료', counts.done, 'text-emerald-500'],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-background/50 px-4 py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
            </div>
          ))}
        </div>
      </section>

      {domain === 'marketing' && (
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Social Measurement</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Instagram · TikTok · LinkedIn · X · Threads. 플랫폼이 제공하지 않는 값은 추정하지 않습니다.
            </p>
          </div>
          <div className="grid gap-3 p-5 xl:grid-cols-5">
            {SOCIAL_CHANNELS.map((channel) => {
              const item = socialByChannel.get(channel)
              return (
                <div key={channel} className="rounded-xl border border-border bg-background/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold capitalize text-foreground">{channel}</div>
                    <span className="text-[11px] text-muted-foreground">
                      {item ? `${item.unique_posts} posts` : socialLoading ? 'loading' : 'no data'}
                    </span>
                  </div>
                  {item ? (
                    <div className="mt-3 space-y-1.5 text-xs">
                      <div className="flex justify-between"><span className="text-muted-foreground">Views</span><span>{nf.format(item.views)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Reach</span><span>{nf.format(item.reach)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Profile visits</span><span>{nf.format(item.profile_visits)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Link clicks</span><span>{nf.format(item.link_clicks)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Website visits</span><span>{nf.format(item.website_visits)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Likes</span><span>{nf.format(item.likes)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">CTR</span><span>{pct(item.ctr)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Visitor→signup</span><span>{pct(item.visitor_to_signup_rate)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Signup conv.</span><span>{pct(item.signup_conversion)}</span></div>
                    </div>
                  ) : (
                    <div className="mt-4 text-xs leading-5 text-muted-foreground">
                      계정/API 또는 공식 export가 연결되면 여기에 실제 지표가 표시됩니다.
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
            Snapshot은 게시물별 최신 누적값만 집계합니다. 같은 게시물의 과거 snapshot을 중복 합산하지 않습니다.
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Work Queue</h2>
            <p className="mt-1 text-xs text-muted-foreground">{domainTasks.length}개 작업</p>
          </div>
        </div>

        {domainTasks.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">{copy.empty}</div>
        ) : (
          <div className="divide-y divide-border">
            {domainTasks.slice(0, 30).map((task) => {
              const workflow = textMeta(task, 'workflow')
              const sourceRef = textMeta(task, 'source_ref')
              const selectedFormat = textMeta(task, 'selected_format')
              const nextAction = textMeta(task, 'next_action')
              const project = projects.find((p) => p.id === task.project_id)

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => openTask(task)}
                  className="w-full px-5 py-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{project?.name || task.project_name || 'General'}</span>
                        {workflow && <span>· {workflow}</span>}
                        {sourceRef && <span className="font-mono">· {sourceRef}</span>}
                        {selectedFormat && (
                          <span className="rounded-md border border-border px-2 py-0.5">{selectedFormat}</span>
                        )}
                      </div>
                      <div className="mt-1.5 truncate text-sm font-medium text-foreground">{task.title}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {nextAction ? `Next: ${nextAction}` : task.description || '다음 작업 정보 없음'}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium ${statusTone(task.status)}`}>
                      {task.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
