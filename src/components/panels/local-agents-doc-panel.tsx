'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface AgentsDocResponse {
  found: boolean
  path: string | null
  content: string | null
  candidates?: string[]
}

export function LocalAgentsDocPanel() {
  const t = useTranslations('localAgentsDoc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AgentsDocResponse | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/local/agents-doc', { cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Failed to load AGENTS.md')
        if (!cancelled) setData(body as AgentsDocResponse)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load AGENTS.md')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const preview = useMemo(() => {
    const content = data?.content || ''
    if (!content) return ''
    const lines = content.split('\n')
    if (expanded || lines.length <= 36) return content
    return `${lines.slice(0, 36).join('\n')}\n\n...`
  }, [data?.content, expanded])

  const openInEditor = () => {
    if (!data?.path) return
    const target = `vscode://file${encodeURI(data.path)}`
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  const copyPath = async () => {
    if (!data?.path) return
    try {
      await navigator.clipboard.writeText(data.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore clipboard failures
    }
  }

  return (
    <div className="mt-4 mx-4 rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
          <p className="text-2xs text-muted-foreground truncate">
            {data?.path || t('noPathFound')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={openInEditor}
            disabled={!data?.path}
          >
            {t('openInVsCode')}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={copyPath}
            disabled={!data?.path}
          >
            {copied ? t('copied') : t('copyPath')}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setExpanded((v) => !v)}
            disabled={!data?.content}
          >
            {expanded ? t('collapse') : t('expand')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-4 text-xs text-muted-foreground">{t('loading')}</div>
      ) : error ? (
        <div className="px-4 py-4 text-xs text-destructive">{error}</div>
      ) : data?.found && data.content ? (
        <pre className="px-4 py-4 text-2xs md:text-xs leading-5 text-muted-foreground overflow-x-auto whitespace-pre-wrap">
          {preview}
        </pre>
      ) : (
        <div className="px-4 py-4 text-xs text-muted-foreground space-y-1">
          <p>{t('notDetected')}</p>
          {data?.candidates && data.candidates.length > 0 && (
            <p className="text-2xs">
              {t('checked', { paths: data.candidates.join(', ') })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
