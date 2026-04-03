'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { JsonSchema } from '@/lib/config-schema-utils'
import { SECTION_META } from './gateway-config-types'
import { computeDiff, matchesSearch } from './schema-utils'
import type { DiffEntry, FormMode } from './gateway-config-types'

interface GatewayConfigData {
  config: Record<string, unknown> | null
  originalConfig: Record<string, unknown> | null
  configPath: string
  configHash: string | null
  schema: JsonSchema | null
  schemaLoading: boolean
  loading: boolean
  error: string | null
  jsonText: string
  sections: string[]
  filteredSections: string[]
  diff: DiffEntry[]
  hasChanges: boolean
  setConfig: (updater: (prev: Record<string, unknown> | null) => Record<string, unknown> | null) => void
  setConfigHash: (h: string | null) => void
  setJsonText: (t: string) => void
  fetchConfig: () => Promise<void>
  fetchSchema: () => Promise<void>
  searchQuery: string
  setSearchQuery: (q: string) => void
  mode: FormMode
  setMode: (m: FormMode) => void
}

/** Encapsulates all data-fetching and derived state for the gateway-config panel */
export function useGatewayConfig(): GatewayConfigData {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [originalConfig, setOriginalConfig] = useState<Record<string, unknown> | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [configHash, setConfigHash] = useState<string | null>(null)
  const [schema, setSchema] = useState<JsonSchema | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [mode, setMode] = useState<FormMode>('form')

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/gateway-config', { signal: AbortSignal.timeout(8000) })
      if (res.status === 403) { setError('Admin access required'); return }
      if (res.status === 404) {
        const data = await res.json()
        setError(data.error || 'Config not found')
        return
      }
      if (!res.ok) { setError('Failed to load config'); return }
      const data = await res.json()
      setConfig(() => data.config)
      setOriginalConfig(data.config)
      setConfigPath(data.path)
      setConfigHash(data.hash ?? null)
      setJsonText(JSON.stringify(data.config, null, 2))
      setError(null)
    } catch {
      setError('Failed to load gateway config')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSchema = useCallback(async () => {
    setSchemaLoading(true)
    try {
      const res = await fetch('/api/gateway-config?action=schema', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json()
        setSchema(data.schema ?? data)
      }
    } catch {
      // Schema is optional — form still works without it
    } finally {
      setSchemaLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig(); fetchSchema() }, [fetchConfig, fetchSchema])

  const sections = useMemo(() => {
    const keys = new Set<string>()
    if (schema?.properties) for (const k of Object.keys(schema.properties)) keys.add(k)
    if (config) for (const k of Object.keys(config)) keys.add(k)
    return [...keys].sort((a, b) => {
      const aMeta = SECTION_META[a], bMeta = SECTION_META[b]
      if (aMeta && !bMeta) return -1
      if (!aMeta && bMeta) return 1
      return a.localeCompare(b)
    })
  }, [schema, config])

  const filteredSections = useMemo(() => {
    if (!searchQuery) return sections
    return sections.filter(key => {
      const sectionSchema = schema?.properties?.[key]
      if (sectionSchema && matchesSearch(key, sectionSchema, searchQuery)) return true
      const meta = SECTION_META[key]
      if (meta?.label.toLowerCase().includes(searchQuery.toLowerCase())) return true
      return key.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [sections, searchQuery, schema])

  const diff = useMemo<DiffEntry[]>(() => {
    if (mode === 'json') return []
    return computeDiff(originalConfig, config)
  }, [originalConfig, config, mode])

  const hasChanges = mode === 'json'
    ? jsonText !== JSON.stringify(originalConfig, null, 2)
    : diff.length > 0

  return {
    config, originalConfig, configPath, configHash, schema, schemaLoading, loading, error,
    jsonText, sections, filteredSections, diff, hasChanges,
    setConfig, setConfigHash, setJsonText, fetchConfig, fetchSchema,
    searchQuery, setSearchQuery, mode, setMode,
  }
}
