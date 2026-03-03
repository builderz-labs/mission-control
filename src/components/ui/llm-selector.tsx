'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface LLMModel {
  id: string
  name: string
  provider: string
  size?: string
  parameters?: string
}

interface LLMSelectorProps {
  value: string
  onChange: (modelId: string) => void
  placeholder?: string
  className?: string
}

export function LLMSelector({ value, onChange, placeholder = 'Select a model...', className = '' }: LLMSelectorProps) {
  const [models, setModels] = useState<LLMModel[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/llms')
      if (res.ok) {
        const data = await res.json()
        setModels(data.models || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = search
    ? models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))
    : models

  const selectedModel = models.find(m => m.id === value)

  const providerBadge: Record<string, string> = {
    ollama: 'bg-blue-500/20 text-blue-400',
    'lm-studio': 'bg-purple-500/20 text-purple-400',
    openai: 'bg-emerald-500/20 text-emerald-400',
    anthropic: 'bg-amber-500/20 text-amber-400',
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-1 border border-border rounded-md text-sm text-foreground hover:bg-surface-2 transition-smooth focus:outline-none focus:ring-1 focus:ring-primary/50"
      >
        <span className={selectedModel ? 'text-foreground' : 'text-muted-foreground'}>
          {loading ? 'Loading models...' : selectedModel ? selectedModel.name : (value || placeholder)}
        </span>
        <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-64 overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full px-2 py-1 text-sm bg-surface-1 border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch('') }}
              className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-surface-2 transition-smooth"
            >
              None (default)
            </button>
            {filtered.length === 0 && !loading && (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {models.length === 0 ? 'No models available' : 'No matches'}
              </div>
            )}
            {filtered.map(model => (
              <button
                type="button"
                key={`${model.provider}-${model.id}`}
                onClick={() => { onChange(model.id); setOpen(false); setSearch('') }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-smooth flex items-center justify-between ${
                  value === model.id ? 'bg-primary/10 text-primary' : 'text-foreground'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{model.name}</div>
                  {model.size && <div className="text-xs text-muted-foreground">{model.size}{model.parameters ? ` · ${model.parameters}` : ''}</div>}
                </div>
                <span className={`text-[10px] px-1 py-0.5 rounded shrink-0 ml-2 ${providerBadge[model.provider] || 'bg-secondary text-muted-foreground'}`}>
                  {model.provider}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
