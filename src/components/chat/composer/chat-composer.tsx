'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getAllModels } from '@/lib/models'
import { modelPickerLabel } from '@/lib/chat-display'
import type { EffortLevel } from '@/lib/chat-model-groups'
import { permissionChip } from '@/lib/permission-menus'
import type { UnifiedPermissionMode } from '@/lib/permission-connector'
import type { UsageTracker } from '@/lib/chat-usage-tracker'
import { ComposerChips } from './composer-chips'
import { ModelPicker } from './model-picker'
import { PermissionMenu } from './permission-menu'
import { UsageBanner } from './usage-banner'
import { UsagePopup } from './usage-popup'
import { IconSend } from '../desktop/chat-icons'

export function ChatComposer({
  placeholder,
  disabled,
  isSending,
  environment,
  project,
  folder,
  modelAlias,
  onModelAlias,
  fastMode,
  onFastMode,
  effort,
  onEffort,
  sessionKind,
  permissionMode,
  onPermissionMode,
  usage,
  onSend,
}: {
  placeholder: string
  disabled?: boolean
  isSending?: boolean
  environment: string
  project: string
  folder: string
  modelAlias: string
  onModelAlias: (alias: string) => void
  fastMode: boolean
  onFastMode: (next: boolean) => void
  effort: EffortLevel
  onEffort: (next: EffortLevel) => void
  sessionKind: string
  permissionMode?: UnifiedPermissionMode
  onPermissionMode?: (mode: UnifiedPermissionMode) => void
  usage: UsageTracker
  onSend: (text: string) => void
}) {
  const t = useTranslations('chatDesktop')
  const [value, setValue] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const model = getAllModels().find((item) => item.alias === modelAlias) || getAllModels()[0]
  const label = model ? modelPickerLabel(model.alias, model.name) : modelAlias
  const chip = permissionChip(sessionKind, permissionMode || 'ask')
  const resize = useCallback(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`
  }, [])
  useEffect(() => { resize() }, [value, resize])
  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled || isSending) return
    onSend(trimmed)
    setValue('')
  }
  const dot = usage.indicator === 'critical' ? 'bg-red-500' : usage.indicator === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'

  return (
    <div className="shrink-0 px-6 pb-5">
      <ComposerChips environment={environment} project={project} folder={folder} />
      {usage.sessionLimitReached ? <UsageBanner resetsAt={usage.sessionLimitResetsAt} /> : null}
      <div className="relative rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] px-3 py-2">
        <textarea
          aria-label={placeholder}
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          disabled={disabled || isSending}
          rows={1}
          className="max-h-40 min-h-[28px] w-full resize-none bg-transparent text-[14px] text-[var(--chat-text)] placeholder:text-[var(--chat-muted)] focus:outline-hidden"
        />
        <div className="mt-1 flex items-center gap-2">
          {onPermissionMode ? (
            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={permOpen}
                onClick={() => setPermOpen((open) => !open)}
                className={`text-[12px] hover:text-[var(--chat-text)] ${chip.accent ? 'text-orange-400' : 'text-[var(--chat-muted)]'}`}
              >
                {chip.text}
              </button>
              {permOpen && (
                <PermissionMenu
                  kind={sessionKind}
                  mode={permissionMode || 'ask'}
                  onChange={onPermissionMode}
                  onClose={() => setPermOpen(false)}
                />
              )}
            </div>
          ) : null}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              className="rounded-md px-1.5 py-0.5 text-[12px] text-[var(--chat-muted)] hover:bg-white/5 hover:text-[var(--chat-text)]"
            >
              {label}
              <span className="ml-2 text-[var(--chat-muted)]">{effort[0]?.toUpperCase()}{effort.slice(1)}</span>
            </button>
            {pickerOpen && (
              <ModelPicker
                value={modelAlias}
                onChange={onModelAlias}
                fastMode={fastMode}
                onFastMode={onFastMode}
                effort={effort}
                onEffort={onEffort}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              aria-label="Usage limits"
              aria-expanded={usageOpen}
              onClick={() => setUsageOpen((open) => !open)}
              className={`h-2.5 w-2.5 rounded-full ${dot}`}
            />
            {usageOpen && <UsagePopup tracker={usage} onClose={() => setUsageOpen(false)} />}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || disabled || isSending}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[var(--chat-text)] disabled:opacity-30"
            aria-label={t('send')}
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  )
}
