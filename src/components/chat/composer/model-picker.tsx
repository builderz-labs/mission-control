'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getAllModels } from '@/lib/models'
import { modelPickerLabel } from '@/lib/chat-display'
import { apiFetch } from '@/lib/api-client'
import {
  ENGINE_META,
  EFFORT_LEVELS,
  accessibleEngines,
  accessibleModels,
  engineForProvider,
  type EffortLevel,
  type EngineId,
  type ProviderAccess,
} from '@/lib/chat-model-groups'
import { EngineLogo } from '@/components/brand/engine-logo'
import { IconCheck } from '../desktop/chat-icons'

export function ModelPicker({
  value,
  onChange,
  fastMode,
  onFastMode,
  effort,
  onEffort,
  onClose,
}: {
  value: string
  onChange: (alias: string) => void
  fastMode: boolean
  onFastMode: (next: boolean) => void
  effort: EffortLevel
  onEffort: (next: EffortLevel) => void
  onClose: () => void
}) {
  const t = useTranslations('chatDesktop')
  const ref = useRef<HTMLDivElement>(null)
  const [access, setAccess] = useState<ProviderAccess>({})
  const catalog = getAllModels()
  const engines = accessibleEngines(access)
  const models = accessibleModels(access, catalog)
  const selected = catalog.find((model) => model.alias === value)
  const selectedEngine = selected ? engineForProvider(selected.provider) : null

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  useEffect(() => {
    apiFetch<{ providers?: ProviderAccess }>('/api/models/access')
      .then((data) => setAccess(data.providers && typeof data.providers === 'object' ? data.providers : {}))
      .catch(() => setAccess({}))
  }, [])

  return (
    <div
      ref={ref}
      className="absolute bottom-12 left-0 z-30 max-h-[420px] w-[300px] overflow-y-auto rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] p-2 shadow-2xl"
    >
      <p className="px-2 pb-1 text-[12px] text-[var(--chat-muted)]">{t('llms')}</p>
      {engines.map((engine) => (
        <EngineRow
          key={engine}
          engine={engine}
          selected={selectedEngine === engine}
          onPick={() => {
            onChange(ENGINE_META[engine].defaultAlias)
            onClose()
          }}
        />
      ))}
      <p className="mt-2 px-2 pb-1 text-[12px] text-[var(--chat-muted)]">{t('models')}</p>
      {models.map((model) => {
        const modelEngine = engineForProvider(model.provider)
        return (
          <button
            key={model.alias}
            type="button"
            className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[13px] text-[var(--chat-text)] hover:bg-white/5"
            onClick={() => {
              onChange(model.alias)
              onClose()
            }}
          >
            <span className="flex min-w-0 items-center gap-2">
              {modelEngine && <EngineLogo engine={modelEngine} size={14} decorative />}
              <span className="truncate">
                {modelPickerLabel(model.alias, model.name)}
                <span className="ml-2 text-[11px] text-[var(--chat-muted)]">{model.description}</span>
              </span>
            </span>
            {value === model.alias && <IconCheck />}
          </button>
        )
      })}
      <label className="mt-2 flex items-center justify-between border-t border-[var(--chat-border)] px-2 py-2 text-[13px]">
        <span>{t('effort')}</span>
        <select
          value={effort}
          onChange={(event) => onEffort(event.target.value as EffortLevel)}
          className="rounded-md border border-[var(--chat-border)] bg-black/30 px-2 py-1 text-[12px] text-[var(--chat-text)]"
          aria-label={t('effort')}
        >
          {EFFORT_LEVELS.map((level) => (
            <option key={level} value={level}>{t(`effortLevel.${level}`)}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between px-2 py-2 text-[13px]">
        <span>{t('fastMode')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={fastMode}
          onClick={() => onFastMode(!fastMode)}
          className={`relative h-5 w-9 rounded-full ${fastMode ? 'bg-[var(--chat-accent)]' : 'bg-white/15'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${fastMode ? 'left-4' : 'left-0.5'}`} />
        </button>
      </div>
    </div>
  )
}

function EngineRow({
  engine,
  selected,
  onPick,
}: {
  engine: EngineId
  selected: boolean
  onPick: () => void
}) {
  const meta = ENGINE_META[engine]
  return (
    <button
      type="button"
      className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-[var(--chat-text)] hover:bg-white/5"
      onClick={onPick}
    >
      <EngineLogo engine={engine} size={16} decorative />
      <span className="flex-1 text-left">{meta.label}</span>
      {selected && <IconCheck />}
    </button>
  )
}
