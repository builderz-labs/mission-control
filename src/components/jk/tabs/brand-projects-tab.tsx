'use client'

import { useState, useEffect } from 'react'
import { ProjectSlideOver, ProjectListCard } from '@/components/jk/project-slide-over'

interface Props {
  brandId: number
}

const SERVICE_ORDER = ['social', 'ads', 'seo', 'website']

export function BrandProjectsTab({ brandId }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/jk/brands/${brandId}/projects`)
      .then(r => r.json())
      .then(json => setProjects(json.projects ?? []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [brandId])

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-neutral-800 rounded-lg" />)}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-8 text-center text-neutral-500">
        <div className="text-2xl mb-2">📋</div>
        <div className="font-medium text-neutral-400">Belum ada project aktif</div>
        <div className="text-sm mt-1">Project akan muncul setelah dibuat via API atau Board global.</div>
      </div>
    )
  }

  // Group by service type
  const grouped = SERVICE_ORDER.reduce<Record<string, typeof projects>>((acc, svc) => {
    const items = projects.filter(p => p.service_type === svc)
    if (items.length > 0) acc[svc] = items
    return acc
  }, {})

  const SERVICE_LABELS: Record<string, string> = {
    seo: '🔍 SEO',
    social: '📱 Social Media',
    ads: '📣 Ads',
    website: '🌐 Website',
  }

  return (
    <>
      <div className="space-y-5">
        {Object.entries(grouped).map(([svc, items]) => (
          <div key={svc}>
            <div className="text-xs font-medium text-neutral-400 mb-2 uppercase tracking-wide">{SERVICE_LABELS[svc] ?? svc}</div>
            <div className="space-y-2">
              {items.map(p => (
                <ProjectListCard
                  key={p.id}
                  project={p}
                  onClick={() => setSelectedId(p.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <ProjectSlideOver
        projectId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  )
}
