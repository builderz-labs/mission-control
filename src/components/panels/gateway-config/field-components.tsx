'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { schemaType, normalizeSchema } from '@/lib/config-schema-utils'
import type { JsonSchema } from '@/lib/config-schema-utils'
import { humanize, defaultValueFor, deepSet } from './schema-utils'

type PatchFn = (path: string[], value: unknown) => void

// ── Field Wrapper ──────────────────────────────────────────────────────────

export function FieldWrapper({ label, help, path, children }: {
  label: string
  help?: string
  path: string[]
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-1.5 px-2 rounded hover:bg-secondary/30">
      <div className="w-40 shrink-0 pt-1.5">
        <div className="text-xs font-medium text-foreground truncate" title={path.join('.')}>{label}</div>
        {help && <div className="text-2xs text-muted-foreground mt-0.5 line-clamp-2">{help}</div>}
      </div>
      <div className="flex-1 flex items-start">{children}</div>
    </div>
  )
}

// ── Object Field (collapsible) ─────────────────────────────────────────────

export function ObjectField({ fieldKey, label, help, schema, value, path, onPatch }: {
  fieldKey: string
  label: string
  help?: string
  schema: JsonSchema
  value: unknown
  path: string[]
  onPatch: PatchFn
}) {
  const [open, setOpen] = useState(path.length <= 1)
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const properties = schema.properties ?? {}
  const entries = Object.entries(properties)
  const entryCount = entries.length || Object.keys(obj).length

  return (
    <div className="ml-2 border-l-2 border-border/40 pl-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 py-1 text-xs hover:text-foreground transition-colors"
      >
        <svg
          className={`w-3 h-3 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 16 16" fill="currentColor"
        >
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-2xs text-muted-foreground">({entryCount})</span>
      </button>
      {help && open && <div className="text-2xs text-muted-foreground ml-5 mb-1">{help}</div>}
      {open && (
        <div className="space-y-1 mt-1">
          {entries.length > 0 ? (
            entries.map(([key, fieldSchema]) => (
              <SchemaField
                key={key}
                fieldKey={key}
                schema={normalizeSchema(fieldSchema)}
                value={obj[key]}
                path={[...path, key]}
                onPatch={onPatch}
              />
            ))
          ) : (
            Object.entries(obj).map(([key, val]) => (
              <FallbackField
                key={key}
                fieldKey={key}
                value={val}
                path={[...path, key]}
                onPatch={onPatch}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Array Field ────────────────────────────────────────────────────────────

export function ArrayField({ label, help, items, itemSchema, path, onPatch }: {
  label: string
  help?: string
  items: unknown[]
  itemSchema?: JsonSchema
  path: string[]
  onPatch: PatchFn
}) {
  return (
    <div className="ml-2 border-l-2 border-border/40 pl-3 py-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-2xs text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onPatch(path, [...items, defaultValueFor(itemSchema)])}
          className="ml-auto text-2xs"
        >+ Add</Button>
      </div>
      {help && <div className="text-2xs text-muted-foreground mb-1">{help}</div>}
      {items.length === 0 ? (
        <div className="text-2xs text-muted-foreground py-2">No items.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-2 items-start bg-secondary/20 rounded p-2">
              <span className="text-2xs text-muted-foreground pt-1.5 w-6 shrink-0">#{idx + 1}</span>
              <div className="flex-1">
                <ArrayItemField
                  idx={idx}
                  item={item}
                  items={items}
                  itemSchema={itemSchema}
                  path={path}
                  onPatch={onPatch}
                />
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="text-red-400 hover:text-red-300 shrink-0"
                onClick={() => {
                  const next = [...items]
                  next.splice(idx, 1)
                  onPatch(path, next)
                }}
              >Del</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Renders a single array item — extracted to keep ArrayField under 50 lines */
function ArrayItemField({ idx, item, items, itemSchema, path, onPatch }: {
  idx: number
  item: unknown
  items: unknown[]
  itemSchema?: JsonSchema
  path: string[]
  onPatch: PatchFn
}) {
  const isObjectItem = itemSchema && schemaType(normalizeSchema(itemSchema)) === 'object'

  if (isObjectItem && itemSchema) {
    return (
      <SchemaField
        fieldKey={String(idx)}
        schema={normalizeSchema(itemSchema)}
        value={item}
        path={[...path, String(idx)]}
        onPatch={(fieldPath, value) => {
          const next = [...items]
          const itemPath = fieldPath.slice(path.length + 1)
          const itemObj = typeof item === 'object' && item !== null ? { ...item as Record<string, unknown> } : {}
          next[idx] = itemPath.length > 0 ? deepSet(itemObj, itemPath, value) : value
          onPatch(path, next)
        }}
      />
    )
  }

  if (itemSchema) {
    return (
      <SchemaField
        fieldKey={String(idx)}
        schema={normalizeSchema(itemSchema)}
        value={item}
        path={[...path, String(idx)]}
        onPatch={(_, value) => {
          const next = [...items]
          next[idx] = value
          onPatch(path, next)
        }}
      />
    )
  }

  return (
    <FallbackField
      fieldKey={String(idx)}
      value={item}
      path={[...path, String(idx)]}
      onPatch={(_, value) => {
        const next = [...items]
        next[idx] = value
        onPatch(path, next)
      }}
    />
  )
}

// ── Fallback Field (no schema) ─────────────────────────────────────────────

export function FallbackField({ fieldKey, value, path, onPatch }: {
  fieldKey: string
  value: unknown
  path: string[]
  onPatch: PatchFn
}) {
  const isRedacted = value === '--------'
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
  const isArray = Array.isArray(value)

  if (isObject) {
    return (
      <ObjectField
        fieldKey={fieldKey}
        label={humanize(fieldKey)}
        schema={{ type: 'object', properties: {} }}
        value={value}
        path={path}
        onPatch={onPatch}
      />
    )
  }

  if (isArray) {
    return (
      <ArrayField
        label={humanize(fieldKey)}
        items={value}
        path={path}
        onPatch={onPatch}
      />
    )
  }

  const isBool = typeof value === 'boolean'
  const isNum = typeof value === 'number'
  const displayValue = String(value ?? '')

  if (isBool) {
    return (
      <label className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-secondary/30 cursor-pointer">
        <span className="text-xs text-foreground">{humanize(fieldKey)}</span>
        <div className="relative">
          <input type="checkbox" checked={value} onChange={e => onPatch(path, e.target.checked)} className="sr-only peer" />
          <div className="w-9 h-5 bg-secondary rounded-full peer-checked:bg-primary/60 transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-foreground rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </div>
      </label>
    )
  }

  return (
    <FieldWrapper label={humanize(fieldKey)} path={path}>
      <input
        type={isNum ? 'number' : isRedacted ? 'password' : 'text'}
        value={displayValue}
        disabled={isRedacted}
        onChange={e => {
          const raw = e.target.value
          if (isNum) { const num = Number(raw); onPatch(path, Number.isNaN(num) ? raw : num) }
          else onPatch(path, raw)
        }}
        className="h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 flex-1 min-w-40 disabled:opacity-50"
      />
    </FieldWrapper>
  )
}

// ── Schema-Driven Field ────────────────────────────────────────────────────

export function SchemaField({ fieldKey, schema, value, path, onPatch }: {
  fieldKey: string
  schema: JsonSchema
  value: unknown
  path: string[]
  onPatch: PatchFn
}) {
  const type = schemaType(schema)
  const label = schema.title ?? humanize(fieldKey)
  const help = schema.description
  const isRedacted = value === '--------'

  if (schema.enum && schema.enum.length > 0) {
    return (
      <FieldWrapper label={label} help={help} path={path}>
        <select
          value={value != null ? String(value) : ''}
          onChange={e => onPatch(path, schema.enum!.find(opt => String(opt) === e.target.value) ?? e.target.value)}
          className="h-8 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-40"
        >
          <option value="">Select...</option>
          {schema.enum.map((opt, i) => <option key={i} value={String(opt)}>{String(opt)}</option>)}
        </select>
      </FieldWrapper>
    )
  }

  if (type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : schema.default === true
    return (
      <label className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-secondary/30 cursor-pointer group">
        <div className="flex-1">
          <div className="text-xs font-medium text-foreground">{label}</div>
          {help && <div className="text-2xs text-muted-foreground mt-0.5">{help}</div>}
        </div>
        <div className="relative">
          <input type="checkbox" checked={checked} onChange={e => onPatch(path, e.target.checked)} className="sr-only peer" />
          <div className="w-9 h-5 bg-secondary rounded-full peer-checked:bg-primary/60 transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-foreground rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </div>
      </label>
    )
  }

  if (type === 'number' || type === 'integer') {
    const numValue = typeof value === 'number' ? value : (typeof schema.default === 'number' ? schema.default : '')
    return (
      <FieldWrapper label={label} help={help} path={path}>
        <input
          type="number"
          value={numValue}
          min={schema.minimum}
          max={schema.maximum}
          onChange={e => {
            const raw = e.target.value
            if (raw === '') { onPatch(path, undefined); return }
            const num = Number(raw)
            onPatch(path, Number.isNaN(num) ? raw : (type === 'integer' ? Math.floor(num) : num))
          }}
          className="h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 w-32"
        />
      </FieldWrapper>
    )
  }

  if (type === 'string') {
    return (
      <FieldWrapper label={label} help={help} path={path}>
        <input
          type={isRedacted ? 'password' : 'text'}
          value={value != null ? String(value) : ''}
          placeholder={schema.default != null ? `Default: ${String(schema.default)}` : ''}
          disabled={isRedacted}
          onChange={e => onPatch(path, e.target.value)}
          className="h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 flex-1 min-w-40 disabled:opacity-50"
        />
      </FieldWrapper>
    )
  }

  if (type === 'array') {
    const arr = Array.isArray(value) ? value : (Array.isArray(schema.default) ? schema.default : [])
    const itemsSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items
    return <ArrayField label={label} help={help} items={arr} itemSchema={itemsSchema} path={path} onPatch={onPatch} />
  }

  if (type === 'object') {
    return <ObjectField fieldKey={fieldKey} label={label} help={help} schema={schema} value={value} path={path} onPatch={onPatch} />
  }

  return <FallbackField fieldKey={fieldKey} value={value} path={path} onPatch={onPatch} />
}
