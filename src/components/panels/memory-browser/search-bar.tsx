'use client'

import React from 'react'
import type { SearchResult } from './types'

interface SearchBarProps {
  searchQuery: string
  isSearching: boolean
  isLoading: boolean
  searchResults: SearchResult[]
  onSearchQueryChange: (query: string) => void
  onSearch: () => void
  onRefresh: () => void
  onSelectResult: (filePath: string) => void
}

export function SearchBar({
  searchQuery,
  isSearching,
  isLoading,
  searchResults,
  onSearchQueryChange,
  onSearch,
  onRefresh,
  onSelectResult,
}: SearchBarProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex space-x-4">
        <div className="flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Search in memory files..."
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={onSearch}
          disabled={isSearching || !searchQuery.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="font-medium text-foreground mb-2">Search Results ({searchResults.length})</h3>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {searchResults.map((result, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-secondary rounded cursor-pointer hover:bg-secondary/80"
                onClick={() => onSelectResult(result.path)}
              >
                <div>
                  <span className="font-medium text-foreground">{result.name}</span>
                  <span className="text-sm text-muted-foreground ml-2">({result.path})</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {result.matches} matches
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
