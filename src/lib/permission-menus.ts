import {
  parsePermissionMode,
  permissionSupport,
  type PermissionRuntime,
  type UnifiedPermissionMode,
} from './permission-connector'

export type NativePermissionOption = {
  id: UnifiedPermissionMode
  title: string
  description: string
  shortcut?: string
  accent?: boolean
}

const CLAUDE_MENU: NativePermissionOption[] = [
  { id: 'auto', title: 'Auto', description: 'Claude handles permission decisions', shortcut: '1' },
  { id: 'ask', title: 'Manual', description: 'Always ask before making changes', shortcut: '2' },
  { id: 'accept_edits', title: 'Accept edits', description: 'Automatically accept all file edits', shortcut: '3' },
  { id: 'plan', title: 'Plan', description: 'Create a plan before making changes', shortcut: '4' },
  { id: 'bypass', title: 'Bypass permissions', description: 'Accepts all permissions', shortcut: '5' },
]

const CHATGPT_MENU: NativePermissionOption[] = [
  { id: 'ask', title: 'Ask for approval', description: 'Always ask to edit external files and use the internet' },
  { id: 'auto', title: 'Approve for me', description: 'Only ask for actions detected as potentially unsafe' },
  { id: 'bypass', title: 'Full access', description: 'access to the internet and any file on your computer', accent: true },
]

const GROK_MENU: NativePermissionOption[] = [
  { id: 'auto', title: 'Auto', description: 'Grok handles permission decisions', shortcut: '1' },
  { id: 'ask', title: 'Ask', description: 'Always ask before making changes', shortcut: '2' },
  { id: 'accept_edits', title: 'Accept edits', description: 'Automatically accept all file edits', shortcut: '3' },
  { id: 'plan', title: 'Plan', description: 'Create a plan before making changes', shortcut: '4' },
  { id: 'bypass', title: 'Always-approve', description: 'Accepts all permissions', shortcut: '5' },
]

const KIMI_MENU: NativePermissionOption[] = [
  { id: 'ask', title: 'Ask for approval', description: 'Always ask before making changes' },
  { id: 'auto', title: 'Approve for me', description: 'Auto-approve regular tool calls' },
  { id: 'bypass', title: 'Full access', description: 'Fully autonomous — the agent will not ask', accent: true },
]

const GATEWAY_MENU: NativePermissionOption[] = [
  { id: 'ask', title: 'Ask for approval', description: 'Show exec approval prompts' },
  { id: 'bypass', title: 'Bypass permissions', description: 'Auto-allow exec approvals once' },
]

const MENUS: Record<PermissionRuntime, NativePermissionOption[]> = {
  'claude-code': CLAUDE_MENU,
  'codex-cli': CHATGPT_MENU,
  grok: GROK_MENU,
  kimi: KIMI_MENU,
  gateway: GATEWAY_MENU,
  opencode: [],
}

export function nativePermissionMenu(kind: string): NativePermissionOption[] {
  if (kind in MENUS) return MENUS[kind as PermissionRuntime]
  return []
}

export function permissionChip(kind: string, mode: UnifiedPermissionMode): {
  text: string
  accent: boolean
  heading: string
} {
  const menu = nativePermissionMenu(kind)
  const selected = menu.find((option) => option.id === mode) || menu[0]
  if (kind === 'codex-cli') {
    return {
      text: selected?.title || 'Ask for approval',
      accent: selected?.id === 'bypass',
      heading: 'How should ChatGPT actions be approved?',
    }
  }
  if (kind === 'claude-code') {
    return {
      text: selected?.title || 'Bypass permissions',
      accent: selected?.id === 'bypass',
      heading: '',
    }
  }
  return {
    text: selected?.title || 'Permissions',
    accent: Boolean(selected?.accent),
    heading: kind === 'kimi' ? 'How should Kimi actions be approved?' : '',
  }
}

export function menuSupportsMode(kind: string, mode: UnifiedPermissionMode): boolean {
  if (permissionSupport(kind) === 'none') return false
  return nativePermissionMenu(kind).some((option) => option.id === mode)
}

export function coerceMenuMode(kind: string, value: unknown): UnifiedPermissionMode {
  const parsed = parsePermissionMode(value)
  const menu = nativePermissionMenu(kind)
  if (menu.some((option) => option.id === parsed)) return parsed
  return menu[0]?.id || 'ask'
}
