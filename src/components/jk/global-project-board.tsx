'use client'

import { useState, useEffect } from 'react'
import { ProjectSlideOver, ProjectListCard } from '@/components/jk/project-slide-over'

const SERVICE_LABELS: Record<string, string> = {
  seo: '🔍 SEO',
  social: '📱 Social',
  ads: '📣 Ads',
  website: '🌐 Website',
}

const SERVICE_ORDER = ['social', 'ads', 'seo', 'website']

type ViewMode = 'by_service' | 'by_brand'

export function GlobalProjectBoard() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('by_service')
  const [filterService, setFilterService] = useState<string>('all')

  useEffect(() => {
    setLoading(true)
    fetch('/api/jk/projects')
      .then(r => r.json())
      .then(json => setProjects(json.projects ?? []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-2 mt-6">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-neutral-800 rounded-lg" />)}
      </div>
    )
  }

  const filtered = filterService === 'all' ? projects : projects.filter(p => p.service_type === filterService)

  const grouped = viewMode === 'by_service'
    ? SERVICE_ORDER.reduce<Record<string, typeof projects>>((acc, svc) => {
        const items = filtered.filter(p => p.service_type === svc)
        if (items.length > 0) acc[svc] = items
        return acc
      }, {})
    : filtered.reduce<Record<string, typeof projects>>((acc, p) => {
        const key = p.brand_name ?? 'Unknown'
        if (!acc[key]) acc[key] = []
        acc[key].push(p)
        return acc
      }, {})

  return (
    <>
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-neutral-100">Project Board</h2>
          <div className="flex items-center gap-2">
            {/* Service filter */}
            <div className="flex gap-1">
              {['all', ...SERVICE_ORDER].map(s => (
                <button
                  key={s}
                  onClick={() => setFilterService(s)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    filterService === s ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {s === 'all' ? 'Semua' : SERVICE_LABELS[s] ?? s}
                </button>
              ))}
            </div>
            {/* Group toggle */}
            <div className="flex rounded overflow-hidden border border-neutral-700">
              <button
                onClick={() => setViewMode('by_service')}
                className={`text-xs px-2.5 py-1 transition-colors ${viewMode === 'by_service' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                Per Layanan
              </button>
              <button
                onClick={() => setViewMode('by_brand')}
                className={`text-xs px-2.5 py-1 transition-colors ${viewMode === 'by_brand' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                Per Brand
              </button>
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="border border-dashed border-neutral-700 rounded-lg p-8 text-center text-neutral-500">
            <div className="text-2xl mb-2">📋</div>
            <div className="font-medium text-neutral-400">Belum ada project aktif</div>
            <div className="text-sm mt-1 text-neutral-600">Project dibuat di Brand Work Session masing-masing brand.</div>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([groupKey, items]) => (
              <div key={groupKey}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                    {viewMode === 'by_service' ? SERVICE_LABELS[groupKey] ?? groupKey : groupKey}
                  </div>
                  <div className="text-xs text-neutral-600">({items.length})</div>
                </div>
                <div className="space-y-2">
                  {items.map(p => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div className="flex-1">
                        <ProjectListCard project={p} onClick={() => setSelectedId(p.id)} />
                      </div>
                      {viewMode === 'by_service' && (
                        <div className="text-xs text-neutral-500 w-32 text-right truncate flex-shrink-0">{p.brand_name}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ProjectSlideOver projectId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  )
}
