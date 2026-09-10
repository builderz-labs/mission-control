'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_CHAT_FILTERS, type ChatFilterState } from '@/lib/group-sessions'
import { parsePins } from '@/lib/chat-display'
import { isEffortLevel, type EffortLevel } from '@/lib/chat-model-groups'

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

export function useChatDesktopPrefs(userId: number | string | undefined) {
  const scope = userId ?? 'anon'
  const filterKey = `mc.chat-desktop.filters.${scope}`
  const pinKey = `mc.chat-desktop.pins.${scope}`
  const modelKey = `mc.chat-desktop.model.${scope}`
  const effortKey = `mc.chat-desktop.effort.${scope}`

  const [filters, setFilters] = useState<ChatFilterState>(DEFAULT_CHAT_FILTERS)
  const [pins, setPins] = useState<string[]>([])
  const [modelAlias, setModelAlias] = useState('opus')
  const [fastMode, setFastMode] = useState(false)
  const [effort, setEffort] = useState<EffortLevel>('medium')

  useEffect(() => {
    setFilters({ ...DEFAULT_CHAT_FILTERS, ...readJson<Partial<ChatFilterState>>(filterKey, {}) })
    setPins(parsePins(typeof window === 'undefined' ? null : window.localStorage.getItem(pinKey)))
    setModelAlias(readJson<string>(modelKey, 'opus') || 'opus')
    const storedEffort = readJson<string>(effortKey, 'medium')
    setEffort(isEffortLevel(storedEffort) ? storedEffort : 'medium')
  }, [filterKey, pinKey, modelKey, effortKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(filterKey, JSON.stringify(filters))
  }, [filterKey, filters])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(pinKey, JSON.stringify(pins))
  }, [pinKey, pins])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(modelKey, JSON.stringify(modelAlias))
  }, [modelKey, modelAlias])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(effortKey, JSON.stringify(effort))
  }, [effortKey, effort])

  return {
    filters,
    setFilters,
    pins,
    setPins,
    modelAlias,
    setModelAlias,
    fastMode,
    setFastMode,
    effort,
    setEffort,
  }
}
