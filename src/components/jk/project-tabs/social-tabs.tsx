'use client'

import { useState } from 'react'
import { MilestonesTab } from './seo-tabs'

type SocialTabId = 'brief' | 'content_plan' | 'post_tracker' | 'cep_coverage'

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  project: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  social: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posts: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  milestones: any[]
}

const TABS: { id: SocialTabId; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'content_plan', label: 'Content Plan' },
  { id: 'post_tracker', label: 'Post Tracker' },
  { id: 'cep_coverage', label: 'CEP Coverage' },
]

const POST_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-neutral-700 text-neutral-300',
  scheduled: 'bg-blue-900/50 text-blue-300',
  posted: 'bg-green-900/50 text-green-300',
  cancelled: 'bg-red-900/50 text-red-300',
}

export function SocialProjectTabs({ project, social, posts, milestones }: Props) {
  const [active, setActive] = useState<SocialTabId>('brief')

  return (
    <div>
      <div className="flex gap-0 border-b border-neutral-700 mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              active === t.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
            {t.id === 'post_tracker' && posts.length > 0 && (
              <span className="ml-1 text-neutral-500">({posts.length})</span>
            )}
          </button>
        ))}
      </div>

      {active === 'brief' && <SocialBriefTab project={project} social={social} milestones={milestones} />}
      {active === 'content_plan' && <ContentPlanTab posts={posts} />}
      {active === 'post_tracker' && <PostTrackerTab posts={posts} />}
      {active === 'cep_coverage' && <CepCoverageTab social={social} posts={posts} />}
    </div>
  )
}

function SocialBriefTab({ project, social, milestones }: { project: Record<string, any>; social: Record<string, any>; milestones: any[] }) {
  const channels: string[] = (() => {
    try { return JSON.parse(social.channels || '[]') } catch { return [] }
  })()

  return (
    <div className="space-y-4">
      {project.description && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Brief Project</div>
          <div className="text-sm text-neutral-200">{project.description}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Channels</div>
          {channels.length > 0
            ? <div className="flex flex-wrap gap-1 mt-1">{channels.map(c => <span key={c} className="text-xs px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded">{c}</span>)}</div>
            : <div className="text-sm text-neutral-500">—</div>
          }
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Target Post/Bulan</div>
          <div className="text-lg font-bold text-neutral-100">{social.monthly_post_target ?? '—'}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">ER Target</div>
          <div className="text-lg font-bold text-neutral-100">{social.er_target != null ? `${social.er_target}%` : '—'}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Tone</div>
          <div className="text-sm text-neutral-200">{social.tone ?? '—'}</div>
        </div>
      </div>
      {social.brand_voice && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Brand Voice</div>
          <div className="text-sm text-neutral-200">{social.brand_voice}</div>
        </div>
      )}
      {social.target_audience && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Target Audience</div>
          <div className="text-sm text-neutral-200">{social.target_audience}</div>
        </div>
      )}
      {milestones.length > 0 && (
        <div>
          <div className="text-xs font-medium text-neutral-400 mb-2">Milestones</div>
          <MilestonesTab milestones={milestones} />
        </div>
      )}
    </div>
  )
}

function ContentPlanTab({ posts }: { posts: any[] }) {
  if (posts.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
        <div className="text-2xl mb-2">📅</div>
        <div className="font-medium text-neutral-400">Belum ada konten direncanakan</div>
        <div className="text-xs mt-1">Konten akan muncul setelah Gate 3 (Content Brief) diapprove.</div>
      </div>
    )
  }

  const byPlatform = posts.reduce<Record<string, any[]>>((acc, p) => {
    if (!acc[p.platform]) acc[p.platform] = []
    acc[p.platform].push(p)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(byPlatform).map(([platform, platformPosts]) => (
        <div key={platform}>
          <div className="text-xs font-medium text-neutral-400 mb-2 uppercase">{platform}</div>
          <div className="space-y-1.5">
            {platformPosts.map(p => (
              <PostRow key={p.id} post={p} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PostTrackerTab({ posts }: { posts: any[] }) {
  const [filter, setFilter] = useState<string>('all')
  const statuses = ['all', 'draft', 'scheduled', 'posted']
  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  if (posts.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
        <div className="text-2xl mb-2">📋</div>
        <div className="font-medium text-neutral-400">Belum ada post</div>
        <div className="text-xs mt-1">Post tracker akan terisi setelah konten dijadwalkan.</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-xs px-2 py-1 rounded ${filter === s ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
          >
            {s === 'all' ? 'Semua' : s} {s !== 'all' && `(${posts.filter(p => p.status === s).length})`}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {filtered.map(p => <PostRow key={p.id} post={p} />)}
      </div>
    </div>
  )
}

function PostRow({ post }: { post: any }) {
  const scheduledDate = post.scheduled_date ? new Date(post.scheduled_date * 1000).toLocaleDateString('id-ID') : null
  return (
    <div className="flex items-start gap-2 bg-neutral-800 rounded px-3 py-2 text-xs">
      <span className="mt-0.5">{post.platform === 'instagram' ? '📸' : post.platform === 'tiktok' ? '🎵' : '📱'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-neutral-200 truncate">{post.concept || post.caption || '(Tanpa judul)'}</div>
        {scheduledDate && <div className="text-neutral-500 mt-0.5">{scheduledDate}</div>}
      </div>
      <span className={`px-1.5 py-0.5 rounded text-xs ${POST_STATUS_COLORS[post.status] ?? 'bg-neutral-700 text-neutral-400'}`}>
        {post.status}
      </span>
    </div>
  )
}

function CepCoverageTab({ social, posts }: { social: Record<string, any>; posts: any[] }) {
  const mapping: Array<{ cep_id: number; cep_name: string }> = (() => {
    try { return JSON.parse(social.cep_pillar_mapping || '[]') } catch { return [] }
  })()

  if (mapping.length === 0 && posts.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
        <div className="text-2xl mb-2">🎯</div>
        <div className="font-medium text-neutral-400">CEP Coverage belum tersedia</div>
        <div className="text-xs mt-1">Mapping CEP akan terisi setelah Gate 2 (CEP Selection) diapprove.</div>
      </div>
    )
  }

  // Count posts per cep_id
  const coverageMap = posts.reduce<Record<number, number>>((acc, p) => {
    if (p.cep_id) acc[p.cep_id] = (acc[p.cep_id] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-2">
      {mapping.map(m => {
        const count = coverageMap[m.cep_id] ?? 0
        return (
          <div key={m.cep_id} className="flex items-center justify-between bg-neutral-800 rounded-lg px-3 py-2.5">
            <span className="text-sm text-neutral-200">{m.cep_name}</span>
            <span className={`text-xs font-medium ${count > 0 ? 'text-green-400' : 'text-neutral-500'}`}>
              {count} post
            </span>
          </div>
        )
      })}
    </div>
  )
}
