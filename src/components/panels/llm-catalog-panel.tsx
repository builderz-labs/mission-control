'use client'

import { useState, useEffect, useCallback } from 'react'

interface LLMModel {
  id: string
  name: string
  provider: string
  size?: string
  quantization?: string
  family?: string
  parameters?: string
  format?: string
  modifiedAt?: string
}

interface LLMProvider {
  id: string
  name: string
  type: 'local' | 'remote'
  endpoint: string
  status: 'online' | 'offline' | 'unknown'
  models: LLMModel[]
}

export function LLMCatalogPanel() {
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [allModels, setAllModels] = useState<LLMModel[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/llms')
      if (res.ok) {
        const data = await res.json()
        setProviders(data.providers || [])
        setAllModels(data.models || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  const filteredModels = allModels.filter(m => {
    if (providerFilter !== 'all' && m.provider !== providerFilter) return false
    if (filter && !m.name.toLowerCase().includes(filter.toLowerCase()) && !m.id.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const providerColors: Record<string, string> = {
    ollama: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'lm-studio': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    openai: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    anthropic: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  }

  const statusColors: Record<string, string> = {
    online: 'bg-green-500',
    offline: 'bg-gray-500',
    unknown: 'bg-yellow-500',
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">LLM Catalog</h1>
            <p className="text-muted-foreground mt-1">
              Discover and manage available language models across all providers
            </p>
          </div>
          <button
            onClick={fetchModels}
            disabled={loading}
            className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth disabled:opacity-50"
          >
            {loading ? 'Scanning...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Provider status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {providers.map(provider => (
          <div
            key={provider.id}
            onClick={() => setProviderFilter(providerFilter === provider.id ? 'all' : provider.id)}
            className={`bg-card border rounded-lg p-4 cursor-pointer transition-smooth ${
              providerFilter === provider.id ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-border/80'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-foreground">{provider.name}</h3>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${statusColors[provider.status]}`} />
                <span className="text-xs text-muted-foreground">{provider.status}</span>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded border ${provider.type === 'local' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
                  {provider.type}
                </span>
                <span className="font-medium text-foreground">{provider.models.length}</span> models
              </div>
              <div className="text-xs mt-1 font-mono truncate">{provider.endpoint}</div>
            </div>
          </div>
        ))}
        {providers.length === 0 && !loading && (
          <div className="col-span-full text-center text-muted-foreground py-8">
            No LLM providers detected. Configure OLLAMA_HOST, LM_STUDIO_HOST, OPENAI_API_KEY, or ANTHROPIC_API_KEY.
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search models..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-surface-1 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-64"
        />
        <span className="text-sm text-muted-foreground">
          {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''}
          {providerFilter !== 'all' && (
            <button onClick={() => setProviderFilter('all')} className="ml-2 text-primary hover:underline">
              Show all
            </button>
          )}
        </span>
      </div>

      {/* Model grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          <span className="ml-3 text-muted-foreground">Scanning providers...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredModels.map(model => (
            <div
              key={`${model.provider}-${model.id}`}
              onClick={() => setSelectedModel(model)}
              className="bg-card border border-border rounded-lg p-4 cursor-pointer hover:bg-surface-2 transition-smooth"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <h4 className="font-medium text-foreground text-sm truncate">{model.name}</h4>
                  {model.id !== model.name && (
                    <p className="text-xs text-muted-foreground font-mono truncate">{model.id}</p>
                  )}
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ml-2 ${providerColors[model.provider] || 'bg-secondary text-muted-foreground border-border'}`}>
                  {model.provider}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {model.size && (
                  <span className="px-1.5 py-0.5 bg-secondary rounded text-muted-foreground">{model.size}</span>
                )}
                {model.parameters && (
                  <span className="px-1.5 py-0.5 bg-secondary rounded text-muted-foreground">{model.parameters}</span>
                )}
                {model.quantization && (
                  <span className="px-1.5 py-0.5 bg-secondary rounded text-muted-foreground">{model.quantization}</span>
                )}
                {model.family && (
                  <span className="px-1.5 py-0.5 bg-secondary rounded text-muted-foreground">{model.family}</span>
                )}
              </div>
            </div>
          ))}
          {filteredModels.length === 0 && !loading && (
            <div className="col-span-full text-center text-muted-foreground py-8">
              No models found{filter ? ` matching "${filter}"` : ''}
            </div>
          )}
        </div>
      )}

      {/* Model detail modal */}
      {selectedModel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedModel(null)}>
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">{selectedModel.name}</h3>
                <p className="text-xs text-muted-foreground font-mono">{selectedModel.id}</p>
              </div>
              <button onClick={() => setSelectedModel(null)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Provider:</span></div>
                <div><span className={`px-1.5 py-0.5 rounded border text-xs ${providerColors[selectedModel.provider] || ''}`}>{selectedModel.provider}</span></div>
                {selectedModel.family && (<><div><span className="text-muted-foreground">Family:</span></div><div>{selectedModel.family}</div></>)}
                {selectedModel.size && (<><div><span className="text-muted-foreground">Size:</span></div><div>{selectedModel.size}</div></>)}
                {selectedModel.parameters && (<><div><span className="text-muted-foreground">Parameters:</span></div><div>{selectedModel.parameters}</div></>)}
                {selectedModel.quantization && (<><div><span className="text-muted-foreground">Quantization:</span></div><div>{selectedModel.quantization}</div></>)}
                {selectedModel.format && (<><div><span className="text-muted-foreground">Format:</span></div><div>{selectedModel.format}</div></>)}
                {selectedModel.modifiedAt && (<><div><span className="text-muted-foreground">Modified:</span></div><div>{new Date(selectedModel.modifiedAt).toLocaleString()}</div></>)}
              </div>
              <div className="pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Use model ID <code className="bg-secondary px-1 py-0.5 rounded font-mono">{selectedModel.id}</code> when configuring agents or cron jobs.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
