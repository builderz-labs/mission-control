import type { MemoryFile } from './types'

export function mergeDirectoryChildren(
  files: MemoryFile[],
  targetPath: string,
  children: MemoryFile[]
): MemoryFile[] {
  return files.map((file) => {
    if (file.path === targetPath && file.type === 'directory') {
      return { ...file, children }
    }
    if (!file.children?.length) return file
    return { ...file, children: mergeDirectoryChildren(file.children, targetPath, children) }
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function countFiles(files: MemoryFile[]): number {
  return files.reduce((acc, f) => {
    if (f.type === 'file') return acc + 1
    return acc + countFiles(f.children || [])
  }, 0)
}

export function totalSize(files: MemoryFile[]): number {
  return files.reduce((acc, f) => {
    if (f.type === 'file' && f.size) return acc + f.size
    return acc + totalSize(f.children || [])
  }, 0)
}

export function fileIcon(name: string): string {
  if (name.endsWith('.md')) return '#'
  if (name.endsWith('.json') || name.endsWith('.jsonl')) return '{}'
  if (name.endsWith('.txt') || name.endsWith('.log')) return '|'
  return '~'
}

export function statusColor(status: 'healthy' | 'warning' | 'critical'): string {
  if (status === 'healthy') return 'text-green-400'
  if (status === 'warning') return 'text-amber-400'
  return 'text-red-400'
}

export function statusBg(status: 'healthy' | 'warning' | 'critical'): string {
  if (status === 'healthy') return 'bg-green-500'
  if (status === 'warning') return 'bg-amber-500'
  return 'bg-red-500'
}
