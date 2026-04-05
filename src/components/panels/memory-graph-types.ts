// Data interfaces matching the /api/memory/graph response
export interface AgentFileInfo {
  path: string
  chunks: number
  textSize: number
}

export interface AgentGraphData {
  name: string
  dbSize: number
  totalChunks: number
  totalFiles: number
  files: AgentFileInfo[]
}

// Obsidian-inspired palette (muted purples, warm grays)
export const AGENT_COLORS: readonly string[] = [
  '#b4befe', // lavender
  '#cba6f7', // mauve
  '#f5c2e7', // pink
  '#89b4fa', // blue
  '#74c7ec', // sapphire
  '#89dceb', // sky
  '#94e2d5', // teal
  '#a6e3a1', // green
  '#f9e2af', // yellow
  '#fab387', // peach
  '#eba0ac', // maroon
  '#f38ba8', // red
  '#cdd6f4', // text
  '#bac2de', // subtext1
  '#a6adc8', // subtext0
  '#b4befe', // lavender2
  '#cba6f7', // mauve2
]

export function getFileColor(filePath: string): string {
  if (filePath.startsWith('sessions/') || filePath.includes('/sessions/')) return '#89dceb'
  if (filePath.startsWith('memory/') || filePath.includes('/memory/')) return '#94e2d5'
  if (filePath.startsWith('knowledge') || filePath.includes('/knowledge')) return '#b4befe'
  if (filePath.endsWith('.md')) return '#f9e2af'
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return '#cba6f7'
  return '#89b4fa'
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
