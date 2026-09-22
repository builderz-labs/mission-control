import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface McpConnector {
  name: string
  cli: string
  transport?: string
  source: string
}

const TOML_SERVER_RE = /^\[mcp_servers(?:\.|")([^\s\]"]+)/gm

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function jsonKeys(path: string, field?: string): string[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readText(path)) as Record<string, unknown>
    const target = field ? parsed[field] : parsed
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      return Object.keys(target as Record<string, unknown>).filter((key) => key !== 'mcpServers')
    }
  } catch {
    return []
  }
  return []
}

export function listClaudeMcp(): McpConnector[] {
  const source = join(homedir(), '.claude.json')
  return jsonKeys(source, 'mcpServers').map((name) => ({
    name, cli: 'claude', source, transport: 'config',
  }))
}

export function listTomlMcp(cli: 'codex' | 'grok', rel: string): McpConnector[] {
  const source = join(homedir(), rel)
  const text = existsSync(source) ? readText(source) : ''
  const names = [...text.matchAll(TOML_SERVER_RE)].map((match) => match[1])
  return names.map((name) => ({ name, cli, source, transport: 'config' }))
}

export function listKimiMcp(): McpConnector[] {
  const source = join(homedir(), '.kimi-code', 'mcp.json')
  const names = jsonKeys(source, 'mcpServers')
  const fallback = names.length ? names : jsonKeys(source)
  return fallback.map((name) => ({ name, cli: 'kimi', source, transport: 'config' }))
}

export function listOpenClawExtensions(): McpConnector[] {
  const dir = join(homedir(), '.openclaw', 'extensions')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      cli: 'openclaw',
      source: dir,
      transport: 'extension',
    }))
}

export function listGrokPlugins(): string[] {
  const dir = join(homedir(), '.grok', 'installed-plugins')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => !name.startsWith('.') && name !== 'registry.json')
}

export function listCodexAutomations(): string[] {
  const dir = join(homedir(), '.codex', 'automations')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}
