'use client'

import type { FormMode } from './gateway-config-types'
import { SECTION_META, TAG_PRESETS } from './gateway-config-types'
import { humanize } from './schema-utils'

interface ConfigSidebarProps {
  configPath: string
  sections: string[]
  filteredSections: string[]
  activeSection: string | null
  searchQuery: string
  mode: FormMode
  sidebarTitle: string
  searchPlaceholder: string
  allSettingsLabel: string
  modeFormLabel: string
  modeJsonLabel: string
  onSetActiveSection: (key: string | null) => void
  onSearchChange: (q: string) => void
  onModeChange: (mode: FormMode) => void
  config: Record<string, unknown> | null
  currentJsonText: string
  onSyncJsonToForm: (text: string) => void
  onSyncFormToJson: (json: string) => void
}

export function ConfigSidebar({
  configPath, sections, filteredSections, activeSection,
  searchQuery, mode, sidebarTitle, searchPlaceholder, allSettingsLabel,
  modeFormLabel, modeJsonLabel, onSetActiveSection, onSearchChange, onModeChange,
  config, currentJsonText, onSyncJsonToForm, onSyncFormToJson,
}: ConfigSidebarProps) {
  return (
    <aside className="w-52 shrink-0 border-r border-border bg-card/50 flex flex-col overflow-hidden">
      <div className="px-3 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-foreground">{sidebarTitle}</h2>
        <p className="text-2xs text-muted-foreground mt-0.5 truncate font-mono">{configPath}</p>
      </div>

      <SidebarSearch
        searchQuery={searchQuery}
        placeholder={searchPlaceholder}
        onSearchChange={onSearchChange}
      />

      <nav className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-0.5">
        <button
          onClick={() => onSetActiveSection(null)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
            activeSection === null
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
          }`}
        >
          <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded bg-secondary text-2xs font-bold">*</span>
          <span>{allSettingsLabel}</span>
        </button>
        {sections.map(key => {
          const meta = SECTION_META[key] ?? { label: humanize(key), icon: key[0].toUpperCase() }
          const isActive = activeSection === key
          if (!filteredSections.includes(key) && searchQuery) return null
          return (
            <button
              key={key}
              onClick={() => onSetActiveSection(isActive ? null : key)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded bg-secondary text-2xs font-bold">{meta.icon}</span>
              <span className="truncate">{meta.label}</span>
            </button>
          )
        })}
      </nav>

      <ModeToggle
        mode={mode}
        modeFormLabel={modeFormLabel}
        modeJsonLabel={modeJsonLabel}
        config={config}
        currentJsonText={currentJsonText}
        onModeChange={onModeChange}
        onSyncJsonToForm={onSyncJsonToForm}
        onSyncFormToJson={onSyncFormToJson}
      />
    </aside>
  )
}

// ── Search bar + tag chips ──────────────────────────────────────────────────

function SidebarSearch({ searchQuery, placeholder, onSearchChange }: {
  searchQuery: string
  placeholder: string
  onSearchChange: (q: string) => void
}) {
  return (
    <div className="px-3 pb-2">
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          className="w-full h-7 pl-7 pr-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <svg className="absolute left-2 top-1.5 w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        {searchQuery && (
          <button onClick={() => onSearchChange('')} className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground text-xs">x</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {TAG_PRESETS.map(tag => (
          <button
            key={tag}
            onClick={() => onSearchChange(
              searchQuery.includes(`tag:${tag}`)
                ? searchQuery.replace(`tag:${tag}`, '').trim()
                : `${searchQuery} tag:${tag}`.trim()
            )}
            className={`text-2xs px-1.5 py-0.5 rounded border transition-colors ${
              searchQuery.includes(`tag:${tag}`)
                ? 'bg-primary/20 border-primary/40 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80'
            }`}
          >{tag}</button>
        ))}
      </div>
    </div>
  )
}

// ── Form / JSON mode toggle ─────────────────────────────────────────────────

function ModeToggle({ mode, modeFormLabel, modeJsonLabel, config, currentJsonText, onModeChange, onSyncJsonToForm, onSyncFormToJson }: {
  mode: FormMode
  modeFormLabel: string
  modeJsonLabel: string
  config: Record<string, unknown> | null
  currentJsonText: string
  onModeChange: (mode: FormMode) => void
  onSyncJsonToForm: (text: string) => void
  onSyncFormToJson: (json: string) => void
}) {
  return (
    <div className="px-3 py-2 border-t border-border">
      <div className="flex rounded-md border border-border overflow-hidden">
        <button
          onClick={() => {
            if (mode === 'json' && config) {
              try { onSyncJsonToForm(currentJsonText) } catch { /* keep current */ }
            }
            onModeChange('form')
          }}
          className={`flex-1 text-xs py-1.5 transition-colors ${
            mode === 'form' ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
          }`}
        >{modeFormLabel}</button>
        <button
          onClick={() => {
            if (mode === 'form' && config) onSyncFormToJson(JSON.stringify(config, null, 2))
            onModeChange('json')
          }}
          className={`flex-1 text-xs py-1.5 transition-colors border-l border-border ${
            mode === 'json' ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
          }`}
        >{modeJsonLabel}</button>
      </div>
    </div>
  )
}
