'use client'

// Panel Artefactos (Tanda 3): índice embebido de la galería Helix (~/artifacts),
// en vez de solo un link externo. El render vive en el artifacts-server (:8446).

import { useCallback, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface Artifact {
  name: string
  title: string
  updatedAt: number
  url: string
}

function timeAgo(epochSec: number): string {
  const mins = Math.floor((Date.now() / 1000 - epochSec) / 60)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

export function ArtifactsPanel() {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null)
  const [galleryUrl, setGalleryUrl] = useState<string>('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/artifacts')
      const data = await res.json()
      if (data.error) setNotice(data.error)
      else setNotice(null)
      setArtifacts(data.artifacts ?? [])
      setGalleryUrl(data.galleryUrl ?? '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar artefactos')
    }
  }, [])

  useSmartPoll(fetchData, 60000)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Artefactos</h2>
          <p className="text-xs text-muted-foreground">
            Galería viva de Helix{artifacts ? ` · ${artifacts.length}` : ''}
          </p>
        </div>
        {galleryUrl && (
          <a
            href={galleryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-info hover:underline"
          >
            Abrir galería ↗
          </a>
        )}
      </div>

      {notice && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          {notice}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!artifacts && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {artifacts && artifacts.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {artifacts.map(a => (
            <a
              key={a.name}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40"
            >
              <div className="min-w-0">
                <p className="truncate font-sans text-sm font-medium group-hover:text-primary">{a.title}</p>
                <p className="truncate font-mono text-2xs text-muted-foreground">{a.name}</p>
              </div>
              <span className="shrink-0 text-2xs text-muted-foreground">{timeAgo(a.updatedAt)}</span>
            </a>
          ))}
        </div>
      )}
      {artifacts && artifacts.length === 0 && !notice && (
        <p className="text-sm text-muted-foreground">Sin artefactos aún.</p>
      )}
    </div>
  )
}
