'use client'

// Entregables first-class en tasks (bloque F4, pedido Musa 11-jul): detecta URLs
// de artefactos (galería helix-artifacts :8446 o *.html del tailnet) en la
// descripción y comentarios de la task, y los embebe DENTRO del detalle — el
// ciclo task→borrador→review sin salir de MC.

import { useMemo, useState } from 'react'

const ARTIFACT_URL_RE = /https?:\/\/[^\s)"'<>\]]+?\.html(?:[?#][^\s)"'<>\]]*)?/g

// Solo la galería helix-artifacts es embebible — allowlist de host:puerto parseada
// con URL(), no substring (un comentario hostil podría colar evil.com/x.html?:8446).
const ALLOWED_HOSTS = new Set(['helix.tail304cfc.ts.net:8446', 'localhost:8446', '127.0.0.1:8446'])

function isArtifactUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED_HOSTS.has(u.host)
  } catch {
    return false
  }
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
            sandbox="allow-scripts"
            className="h-[420px] w-full bg-background"
          />
        </div>
      )}
    </div>
  )
}
