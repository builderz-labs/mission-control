export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (['py'].includes(ext)) return 'hsl(var(--success))'
  if (['js', 'ts', 'tsx', 'jsx'].includes(ext)) return 'hsl(var(--void-amber))'
  if (['pdf'].includes(ext)) return 'hsl(var(--destructive))'
  if (['json', 'yaml', 'yml', 'xml'].includes(ext)) return 'hsl(var(--void-cyan))'
  if (['md', 'txt'].includes(ext)) return 'hsl(var(--void-violet))'
  return 'hsl(var(--info))'
}
