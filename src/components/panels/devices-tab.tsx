'use client'

import { PendingDevicesSection } from './pending-devices-section'
import { PairedDevicesSection } from './paired-devices-section'
import type { PairedDevice, PendingDevice } from './nodes-panel-types'

interface DevicesTabProps {
  readonly devices: PairedDevice[]
  readonly pendingDevices: PendingDevice[]
  readonly onRefresh: () => void
}

export function DevicesTab({
  devices,
  pendingDevices,
  onRefresh,
}: DevicesTabProps): React.ReactElement {
  return (
    <div className="space-y-6">
      {pendingDevices.length > 0 && (
        <PendingDevicesSection devices={pendingDevices} onRefresh={onRefresh} />
      )}
      <PairedDevicesSection devices={devices} onRefresh={onRefresh} />
    </div>
  )
}
