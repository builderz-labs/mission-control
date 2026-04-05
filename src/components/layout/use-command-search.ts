'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useNavigateToPanel, usePrefetchPanel } from '@/lib/navigation'
import { type SearchResult, QUICK_NAV_COMMANDS } from './command-palette-types'

interface UseCommandSearchReturn {
  searchOpen: boolean
  searchQuery: string
  searchResults: SearchResult[]
  searchLoading: boolean
  selectedIndex: number
  searchRef: React.RefObject<HTMLDivElement | null>
  searchInputRef: React.RefObject<HTMLInputElement | null>
  resultButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>
  openCommandPalette: () => void
  handleSearchInput: (value: string) => void
  handleResultClick: (result: SearchResult) => void
  setSearchOpen: (open: boolean) => void
  setSelectedIndex: (index: number) => void
}

export function useCommandSearch(): UseCommandSearchReturn {
  const th = useTranslations('header')
  const navigateToPanel = useNavigateToPanel()
  const prefetchPanel = usePrefetchPanel()

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const getQuickNavResults = useCallback((q: string): SearchResult[] => {
    const normalized = q.trim().toLowerCase()
    if (!normalized) {
      return QUICK_NAV_COMMANDS.slice(0, 6).map((cmd, index) => ({
        type: 'panel',
        id: -(index + 1),
        title: th(cmd.titleKey),
        subtitle: `/${cmd.panel}`,
        excerpt: th('quickNavigation'),
        created_at: Date.now(),
        panel: cmd.panel,
        source: 'command' as const,
      }))
    }

    const ranked: Array<SearchResult & { _score: number }> = []
    for (let index = 0; index < QUICK_NAV_COMMANDS.length; index++) {
      const cmd = QUICK_NAV_COMMANDS[index]
      const translatedTitle = th(cmd.titleKey)
      const haystack = `${translatedTitle} ${cmd.title} ${cmd.panel} ${cmd.aliases.join(' ')}`.toLowerCase()
      if (!haystack.includes(normalized)) continue
      const exactPanel = cmd.panel === normalized
      const startsTitle = translatedTitle.toLowerCase().startsWith(normalized)
      const score = exactPanel ? 3 : startsTitle ? 2 : 1
      ranked.push({
        type: 'panel',
        id: -(index + 1),
        title: translatedTitle,
        subtitle: `/${cmd.panel}`,
        excerpt: cmd.aliases.length ? `Aliases: ${cmd.aliases.join(', ')}` : th('quickNavigation'),
        created_at: Date.now(),
        panel: cmd.panel,
        source: 'command' as const,
        _score: score,
      })
    }
    return ranked
      .sort((a, b) => b._score - a._score)
      .map(({ _score: _s, ...row }) => row)
      .slice(0, 8)
  }, [th])

  const openCommandPalette = useCallback((): void => {
    setSearchOpen(true)
    setSearchResults(getQuickNavResults(''))
    setSelectedIndex(0)
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [getQuickNavResults])

  const handleResultClick = useCallback((result: SearchResult): void => {
    if (result.panel) {
      prefetchPanel(result.panel)
      navigateToPanel(result.panel)
      setSearchOpen(false)
      setSearchQuery('')
      setSearchResults([])
      return
    }
    const typeToTab: Record<string, string> = {
      task: 'tasks', agent: 'agents', activity: 'activity',
      audit: 'audit', message: 'agents', notification: 'notifications',
      webhook: 'webhooks', pipeline: 'agents', alert_rule: 'alerts',
    }
    navigateToPanel(typeToTab[result.type] || 'overview')
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
  }, [navigateToPanel, prefetchPanel])

  const doSearch = useCallback(async (q: string): Promise<void> => {
    const quickResults = getQuickNavResults(q)
    if (q.length < 2) {
      setSearchResults(quickResults)
      setSelectedIndex(0)
      return
    }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`, { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      const entityResults: SearchResult[] = (data.results || []).map((r: SearchResult) => ({ ...r, source: 'entity' as const }))
      const merged = [...quickResults, ...entityResults].slice(0, 16)
      setSearchResults(merged)
      setSelectedIndex(0)
    } catch {
      setSearchResults(quickResults)
      setSelectedIndex(0)
    } finally {
      setSearchLoading(false)
    }
  }, [getQuickNavResults])

  const handleSearchInput = (value: string): void => {
    setSearchQuery(value)
    setSelectedIndex(0)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => { void doSearch(value) }, 250)
  }

  // Keyboard shortcuts: Cmd/Ctrl+K and /
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const isTypingTarget =
        !!target &&
        (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable
        )

      if (searchOpen) {
        handleSearchOpenKeydown(e, searchResults, selectedIndex, setSelectedIndex, resultButtonRefs, searchInputRef, handleResultClick)
        return
      }
      if (!isTypingTarget && e.key === '/') {
        e.preventDefault()
        openCommandPalette()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openCommandPalette()
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleResultClick, openCommandPalette, searchOpen, searchResults, selectedIndex])

  // Close on outside click
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e: MouseEvent): void => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen])

  // Prevent background scroll while command palette is open
  useEffect(() => {
    if (!searchOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [searchOpen])

  // Scroll selected result into view
  useEffect(() => {
    if (!searchOpen) return
    resultButtonRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [searchOpen, selectedIndex, searchResults])

  // Keep ref array in sync with results length
  useEffect(() => {
    resultButtonRefs.current = resultButtonRefs.current.slice(0, searchResults.length)
  }, [searchResults.length])

  return {
    searchOpen,
    searchQuery,
    searchResults,
    searchLoading,
    selectedIndex,
    searchRef,
    searchInputRef,
    resultButtonRefs,
    openCommandPalette,
    handleSearchInput,
    handleResultClick,
    setSearchOpen,
    setSelectedIndex,
  }
}

/** Handles keyboard navigation while the command palette is open. */
function handleSearchOpenKeydown(
  e: KeyboardEvent,
  searchResults: SearchResult[],
  selectedIndex: number,
  setSelectedIndex: (i: number) => void,
  resultButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>,
  searchInputRef: React.RefObject<HTMLInputElement | null>,
  handleResultClick: (r: SearchResult) => void,
): void {
  if (e.key === 'Tab') {
    const focusables = [
      searchInputRef.current,
      ...resultButtonRefs.current,
    ].filter((el): el is HTMLInputElement | HTMLButtonElement => el !== null)
    if (focusables.length > 0) {
      e.preventDefault()
      const activeEl = document.activeElement as (HTMLInputElement | HTMLButtonElement | null)
      const currentIndex = focusables.findIndex((el) => el === activeEl)
      const nextIndex = e.shiftKey
        ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
        : (currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1)
      focusables[nextIndex]?.focus()
    }
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = Math.min(selectedIndex + 1, Math.max(0, searchResults.length - 1))
    setSelectedIndex(next)
    resultButtonRefs.current[next]?.focus()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    const next = Math.max(selectedIndex - 1, 0)
    setSelectedIndex(next)
    resultButtonRefs.current[next]?.focus()
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    setSelectedIndex(0)
    resultButtonRefs.current[0]?.focus()
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    const last = Math.max(0, searchResults.length - 1)
    setSelectedIndex(last)
    resultButtonRefs.current[last]?.focus()
    return
  }
  if (e.key === 'Enter') {
    const selected = searchResults[selectedIndex]
    if (selected) {
      e.preventDefault()
      handleResultClick(selected)
    }
  }
}
