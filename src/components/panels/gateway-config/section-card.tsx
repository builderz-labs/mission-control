'use client'

import { useState } from 'react'
import { normalizeSchema } from '@/lib/config-schema-utils'
import { schemaType } from '@/lib/config-schema-utils'
import type { JsonSchema } from '@/lib/config-schema-utils'
import { humanize, matchesSearch } from './schema-utils'
import { SchemaField, FallbackField } from './field-components'

interface SectionCardProps {
  sectionKey: string
  label: string
  icon: string
  description?: string
  schema?: JsonSchema
  value: unknown
  searchQuery: string
  onPatch: (path: string[], value: unknown) => void
}

export function SectionCard({ sectionKey, label, icon, description, schema, value, searchQuery, onPatch }: SectionCardProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors"
      >
        <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-bold">{icon}</span>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {description && <div className="text-2xs text-muted-foreground mt-0.5">{description}</div>}
        </div>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          <SectionCardBody
            sectionKey={sectionKey}
            schema={schema}
            value={value}
            searchQuery={searchQuery}
            onPatch={onPatch}
          />
        </div>
      )}
    </div>
  )
}

/** Body extracted so SectionCard stays under 50 lines */
function SectionCardBody({ sectionKey, schema, value, searchQuery, onPatch }: {
  sectionKey: string
  schema?: JsonSchema
  value: unknown
  searchQuery: string
  onPatch: (path: string[], value: unknown) => void
}) {
  if (schema && schemaType(schema) === 'object' && schema.properties) {
    return (
      <>
        {Object.entries(schema.properties).map(([key, fieldSchema]) => {
          if (searchQuery && !matchesSearch(key, fieldSchema, searchQuery)) return null
          const fieldValue = value && typeof value === 'object'
            ? (value as Record<string, unknown>)[key]
            : undefined
          return (
            <SchemaField
              key={key}
              fieldKey={key}
              schema={normalizeSchema(fieldSchema)}
              value={fieldValue}
              path={[key]}
              onPatch={onPatch}
            />
          )
        })}
      </>
    )
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <>
        {Object.entries(value as Record<string, unknown>).map(([key, val]) => {
          if (searchQuery && !key.toLowerCase().includes(searchQuery.toLowerCase())) return null
          return <FallbackField key={key} fieldKey={key} value={val} path={[key]} onPatch={onPatch} />
        })}
      </>
    )
  }

  return (
    <FallbackField
      fieldKey={sectionKey}
      value={value}
      path={[]}
      onPatch={onPatch}
    />
  )
}

// Re-export so callers can import humanize from here if needed for section labels
export { humanize }
