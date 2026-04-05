// Maps log level strings to Tailwind color classes for display
export function getLogLevelColor(level: string): string {
  switch (level.toLowerCase()) {
    case 'error': return 'text-red-400'
    case 'warn': return 'text-yellow-400'
    case 'info': return 'text-blue-400'
    case 'debug': return 'text-muted-foreground'
    default: return 'text-foreground'
  }
}

// Maps log level strings to border/background classes for row styling
export function getLogLevelBg(level: string): string {
  switch (level.toLowerCase()) {
    case 'error': return 'bg-red-500/10 border-red-500/20'
    case 'warn': return 'bg-yellow-500/10 border-yellow-500/20'
    case 'info': return 'bg-blue-500/10 border-blue-500/20'
    case 'debug': return 'bg-gray-500/10 border-gray-500/20'
    default: return 'bg-secondary border-border'
  }
}
