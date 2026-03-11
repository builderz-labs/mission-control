'use client'

import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

interface ConnectionStatusProps {
  isConnected: boolean
  onConnect: () => void
  onDisconnect: () => void
  onReconnect?: () => void
}

export function ConnectionStatus({ 
  isConnected, 
  onConnect, 
  onDisconnect, 
  onReconnect 
}: ConnectionStatusProps) {
  const { connection } = useMissionControl()
  const displayUrl = connection.url || 'ws://<gateway-host>:<gateway-port>'
  const isGatewayOptional = process.env.NEXT_PUBLIC_GATEWAY_OPTIONAL === 'true'

  const getStatusColor = () => {
    if (isConnected) return 'bg-green-500 animate-pulse'
    if (connection.reconnectAttempts > 0) return 'bg-yellow-500'
    if (isGatewayOptional && !isConnected) return 'bg-blue-500'
    return 'bg-red-500'
  }

  const getStatusText = () => {
    if (isConnected) {
      return 'Connected'
    }
    if (connection.reconnectAttempts > 0) {
      return `Reconnecting... (${connection.reconnectAttempts}/10)`
    }
    if (isGatewayOptional && !isConnected) {
      return 'Gateway Optional (Standalone)'
    }
    return 'Disconnected'
  }

  return (
    <div className="flex items-center space-x-4">
      {/* Connection Status Indicator */}
      <div className="flex items-center space-x-2">
        <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
        <span className="text-sm font-medium">
          {getStatusText()}
        </span>
        <span className="text-xs text-muted-foreground">
          {displayUrl}
        </span>
      </div>

      {/* Connection Controls */}
      <div className="flex items-center space-x-2">
        {isConnected ? (
          <Button
            variant="destructive"
            size="xs"
            onClick={onDisconnect}
            title="Disconnect from gateway"
          >
            Disconnect
          </Button>
        ) : connection.reconnectAttempts > 0 ? (
          <Button
            variant="outline"
            size="xs"
            onClick={onDisconnect}
            className="bg-gray-500/20 text-gray-400 border-gray-500/30 hover:bg-gray-500/30"
            title="Cancel reconnection attempts"
          >
            Cancel
          </Button>
        ) : (
          <div className="flex space-x-1">
            <Button
              variant="success"
              size="xs"
              onClick={onConnect}
              title="Connect to gateway"
            >
              Connect
            </Button>
            {onReconnect && (
              <Button
                variant="outline"
                size="xs"
                onClick={onReconnect}
                className="bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30"
                title="Reconnect with fresh session"
              >
                Reconnect
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Real-time Status */}
      <div className="flex items-center space-x-2 text-xs text-muted-foreground">
        {connection.latency ? (
          <>
            <span>Latency:</span>
            <span className="font-mono">{connection.latency}ms</span>
          </>
        ) : connection.lastConnected ? (
          <>
            <span>Last connected:</span>
            <span className="font-mono">
              {new Date(connection.lastConnected).toLocaleTimeString()}
            </span>
          </>
        ) : (
          <>
            <span>Status:</span>
            <span className="font-mono">Not connected</span>
          </>
        )}
      </div>
    </div>
  )
}
