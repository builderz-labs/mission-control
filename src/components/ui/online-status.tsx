'use client'

interface OnlineStatusProps {
  isConnected: boolean
}

export function OnlineStatus({ isConnected }: OnlineStatusProps) {
  return (
    <div className="flex items-center space-x-2">
      <div className={`w-2 h-2 rounded-full ${
        isConnected ? 'bg-green-500 status-online' : 'bg-red-500'
      }`}></div>
      <span className={`text-sm font-semibold tracking-wide ${
        isConnected ? 'text-green-400' : 'text-red-400'
      }`}>
        {isConnected ? 'ONLINE' : 'OFFLINE'}
      </span>
    </div>
  )
}