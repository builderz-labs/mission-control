'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type SearchResult, TYPE_ICONS, TYPE_COLORS } from './command-palette-types'

interface CommandPaletteProps {
  searchRef: React.RefObject<HTMLDivElement | null>
  searchInputRef: React.RefObject<HTMLInputElement | null>
  resultButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>
  searchQuery: string
  searchResults: SearchResult[]
  searchLoading: boolean
  selectedIndex: number
  onSearchInput: (value: string) => void
  onResultClick: (result: SearchResult) => void
  onClose: () => void
  onHoverResult: (index: number) => void
}

export function CommandPalette({
  searchRef,
  searchInputRef,
  resultButtonRefs,
  searchQuery,
  searchResults,
  searchLoading,
  selectedIndex,
  onSearchInput,
  onResultClick,
  onClose,
  onHoverResult,
}: CommandPaletteProps): React.ReactElement {
  const th = useTranslations('header')

  return (
    <div
      ref={searchRef}
      className="fixed inset-0 z-[9999] isolate"
      role="dialog"
      aria-modal="true"
      aria-label="Command search"
    >
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/30 to-black/30"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="command-palette-in w-full max-w-[44rem] max-h-[min(78vh,40rem)] bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => onSearchInput(e.target.value)}
              placeholder={th('searchPlaceholder')}
              className="w-full h-9 px-3 rounded-md bg-secondary border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
              role="combobox"
              aria-expanded={true}
              aria-controls="mc-command-results"
              aria-activedescendant={searchResults[selectedIndex] ? `mc-command-result-${selectedIndex}` : undefined}
            />
          </div>
          <CommandResultList
            searchResults={searchResults}
            searchLoading={searchLoading}
            searchQuery={searchQuery}
            selectedIndex={selectedIndex}
            resultButtonRefs={resultButtonRefs}
            onResultClick={onResultClick}
            onHoverResult={onHoverResult}
          />
        </div>
      </div>
    </div>
  )
}

interface CommandResultListProps {
  searchResults: SearchResult[]
  searchLoading: boolean
  searchQuery: string
  selectedIndex: number
  resultButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>
  onResultClick: (result: SearchResult) => void
  onHoverResult: (index: number) => void
}

function CommandResultList({
  searchResults,
  searchLoading,
  searchQuery,
  selectedIndex,
  resultButtonRefs,
  onResultClick,
  onHoverResult,
}: CommandResultListProps): React.ReactElement {
  const th = useTranslations('header')

  return (
    <div
      id="mc-command-results"
      role="listbox"
      className="bg-card max-h-[calc(min(78vh,40rem)-3.25rem)] overflow-y-auto"
    >
      {searchLoading ? (
        <div className="p-4 text-center text-xs text-muted-foreground">{th('searching')}</div>
      ) : searchResults.length > 0 ? (
        searchResults.map((r, i) => (
          <Button
            key={`${r.type}-${r.id}-${i}`}
            ref={(el) => { resultButtonRefs.current[i] = el }}
            variant="ghost"
            onClick={() => onResultClick(r)}
            onMouseEnter={() => onHoverResult(i)}
            id={`mc-command-result-${i}`}
            role="option"
            aria-selected={i === selectedIndex}
            tabIndex={i === selectedIndex ? 0 : -1}
            className={`w-full text-left px-3 py-2 h-auto rounded-none justify-start items-start gap-2.5 hover:bg-secondary/80 ${
              i === selectedIndex ? 'bg-secondary' : 'bg-card'
            }`}
          >
            <span className={`text-2xs font-medium w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 ${TYPE_COLORS[r.type] || 'bg-muted text-muted-foreground'}`}>
              {TYPE_ICONS[r.type] || '?'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">{r.title}</div>
              {r.subtitle && <div className="text-2xs text-muted-foreground truncate">{r.subtitle}</div>}
              {r.excerpt && <div className="text-2xs text-muted-foreground/70 truncate mt-0.5">{r.excerpt}</div>}
            </div>
          </Button>
        ))
      ) : searchQuery.length >= 2 ? (
        <div className="p-4 text-center text-xs text-muted-foreground">{th('noResults')}</div>
      ) : (
        <div className="p-4 text-center text-xs text-muted-foreground">{th('typeToSearch')}</div>
      )}
    </div>
  )
}
