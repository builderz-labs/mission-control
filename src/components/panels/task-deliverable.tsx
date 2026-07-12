'use client'

// Entregables first-class en tasks (bloque F4, pedido Musa 11-jul): detecta URLs
// de artefactos (galería helix-artifacts :8446 o *.html del tailnet) en la
// descripción y comentarios de la task, y los embebe DENTRO del detalle — el
// ciclo task→borrador→review sin salir de MC.

import { useMemo, useState } from 'react'

const ARTIFACT_URL_RE = /https?:\/\/[^\s)"'<>\]]+?\.html(?:[?#][^\s)"'<>\]]*)?/g

function isArtifactUrl(url: string): boolean {
  return url.includes(':8446') || url.includes('/artifacts')
}

export function extractDeliverables(texts: Array<string | null | undefined>): string[] {
  const found: string[] = []
  for (const text of texts) {
    if (!text) continue
    for (const m of text.match(ARTIFACT_URL_RE) ?? []) {
      if (isArtifactUrl(m) && !found.includes(m)) found.push(m)
    }
  }
  return found
}

export function TaskDeliverables({ texts }: { texts: Array<string | null | undefined> }) {
  const urls = useMemo(() => extractDeliverables(texts), [texts])
  const [open, setOpen] = useState<string | null>(urls[0] ?? null)

  if (urls.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Entregable</span>
        <span className="rounded border border-primary/40 px-1.5 font-mono text-2xs text-primary tabular-nums">
          {urls.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {urls.map(url => {
          const name = decodeURIComponent(url.split('/').pop()?.replace(/\.html.*$/, '') ?? url)
          const active = open === url
          return (
            <button
              key={url}
              onClick={() => setOpen(active ? null : url)}
              className={`rounded border px-2 py-1 font-mono text-2xs transition-colors duration-150 ${
                active
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>
      {open && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-3 py-1.5">
            <span className="truncate font-mono text-2xs text-muted-foreground">{open}</span>
            <a
              href={open}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-2xs text-info hover:underline"
            >
              abrir aparte ↗
            </a>
          </div>
          <iframe
            src={open}
            title="Entregable de la task"
            sandbox="allow-scripts allow-same-origin"
            className="h-[420px] w-full bg-background"
          />
        </div>
      )}
    </div>
  )
}
