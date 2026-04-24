'use client'

import { useEffect, useState, useTransition } from 'react'
import { SeoProjectTabs } from './project-tabs/seo-tabs'
import { SocialProjectTabs } from './project-tabs/social-tabs'
import { AdsProjectTabs } from './project-tabs/ads-tabs'
import { WebsiteProjectTabs } from './project-tabs/website-tabs'

interface ProjectSummary {
  id: number
  name: string
  service_type: string
  status: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface Props {
  projectId: number | null
  onClose: () => void
}

const SERVICE_ICONS: Record<string, string> = {
  seo: '🔍',
  social: '📱',
  ads: '📣',
  website: '🌐',
}

const SERVICE_LABELS: Record<string, string> = {
  seo: 'SEO',
  social: 'Social Media',
  ads: 'Ads',
  website: 'Website',
}

export function ProjectSlideOver({ projectId, onClose }: Props) {
  const [data, setData] = useState<Record<string, any> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (projectId == null) {
      setData(null)
      setError(null)
      return
    }

    setData(null)
    setError(null)

    startTransition(() => {
      fetch(`/api/jk/projects/${projectId}`)
        .then(r => r.json())
        .then(json => {
          if (json.error) setError(json.error)
          else setData(json)
        })
        .catch(() => setError('Gagal memuat data project'))
    })
  }, [projectId])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const isOpen = projectId != null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-2xl bg-neutral-950 border-l border-neutral-800 z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-neutral-800 flex-shrink-0">
          {data ? (
            <div>
              <div className="flex items-center gap-2">
                <span>{SERVICE_ICONS[data.service_type] ?? '📋'}</span>
                <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
                  {SERVICE_LABELS[data.service_type] ?? 'Project'}
                </span>
              </div>
              <h2 className="text-lg font-bold text-neutral-100 mt-1">{data.project?.name}</h2>
              <div className="text-xs text-neutral-500 mt-0.5">ID #{data.project?.id}</div>
            </div>
          ) : (
            <div className="animate-pulse">
              <div className="h-3 w-16 bg-neutral-800 rounded mb-2" />
              <div className="h-5 w-48 bg-neutral-800 rounded" />
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition-colors ml-4 flex-shrink-0"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</div>
          )}

          {!data && !error && (
            <SlideOverSkeleton />
          )}

          {data && data.service_type === 'seo' && (
            <SeoProjectTabs
              project={data.project}
              seo={data.seo}
              keywords={data.keywords ?? []}
              milestones={data.milestones ?? []}
            />
          )}

          {data && data.service_type === 'social' && (
            <SocialProjectTabs
              project={data.project}
              social={data.social}
              posts={data.posts ?? []}
              milestones={data.milestones ?? []}
            />
          )}

          {data && data.service_type === 'ads' && (
            <AdsProjectTabs
              project={data.project}
              ads={data.ads}
              campaigns={data.campaigns ?? []}
              milestones={data.milestones ?? []}
            />
          )}

          {data && data.service_type === 'website' && (
            <WebsiteProjectTabs
              project={data.project}
              website={data.website}
              milestones={data.milestones ?? []}
            />
          )}

          {data && !data.service_type && (
            <GenericProjectView project={data.project} milestones={data.milestones ?? []} />
          )}
        </div>
      </div>
    </>
  )
}

function GenericProjectView({ project, milestones }: { project: Record<string, any>; milestones: any[] }) {
  return (
    <div className="space-y-4">
      {project.description && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Deskripsi</div>
          <div className="text-sm text-neutral-200">{project.description}</div>
        </div>
      )}
      {milestones.length > 0 && (
        <div>
          <div className="text-xs font-medium text-neutral-400 mb-2">Milestones</div>
          {milestones.map((m: any) => (
            <div key={m.id} className="flex items-center gap-2 bg-neutral-800 rounded px-3 py-2 text-xs mb-1.5">
              <span>{m.status === 'completed' ? '✅' : '⏳'}</span>
              <span className="text-neutral-200">{m.milestone_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SlideOverSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex gap-2 border-b border-neutral-800 pb-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-7 w-20 bg-neutral-800 rounded" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-16 bg-neutral-800 rounded-lg" />
        ))}
      </div>
      <div className="h-24 bg-neutral-800 rounded-lg" />
    </div>
  )
}

// ─── Project list card used in the Projects tab ─────────────────────────────

interface ProjectCardProps {
  project: ProjectSummary
  onClick: () => void
}

export function ProjectListCard({ project, onClick }: ProjectCardProps) {
  const icon = SERVICE_ICONS[project.service_type] ?? '📋'
  const label = SERVICE_LABELS[project.service_type] ?? project.service_type

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-neutral-500 rounded-lg px-4 py-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <div>
            <div className="text-sm font-medium text-neutral-100">{project.name}</div>
            <div className="text-xs text-neutral-400 mt-0.5">{label}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {project.overdue_count > 0 && (
            <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">
              {project.overdue_count} overdue
            </span>
          )}
          <span className="text-neutral-500 text-xs">→</span>
        </div>
      </div>
    </button>
  )
}
