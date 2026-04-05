// Types shared across nodes-panel sub-components

export interface PresenceEntry {
  id: string
  clientId: string
  displayName: string
  platform: string
  version: string
  roles: string[]
  connectedAt: number
  lastActivity: number
  host?: string
  ip?: string
  status: 'online' | 'idle' | 'offline'
}

export interface DeviceTokenSummary {
  role: string
  scopes?: string[]
  createdAtMs?: number
  rotatedAtMs?: number
  revokedAtMs?: number
  lastUsedAtMs?: number
}

export interface PendingDevice {
  requestId: string
  deviceId: string
  displayName?: string
  role?: string
  remoteIp?: string
  isRepair?: boolean
  ts?: number
}

export interface PairedDevice {
  id: string
  deviceId: string
  displayName: string
  publicKey?: string
  pairedAt?: number
  lastSeen?: number
  trusted?: boolean
  roles?: string[]
  scopes?: string[]
  tokens?: DeviceTokenSummary[]
  createdAtMs?: number
  approvedAtMs?: number
}

export type Tab = 'instances' | 'devices'
