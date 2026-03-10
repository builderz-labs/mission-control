import type { Metadata } from 'next'
import { ForgeObservatory } from '@/components/forge/forge-observatory'
import { getForgePlatformData } from '@/lib/forge/platform-data'

export const metadata: Metadata = {
  title: 'Marcuzx Forge Observatory',
  description: 'Observability and readiness MVP for the Marcuzx Forge platform.',
}

export const revalidate = 60

export default async function ForgeObservatoryPage() {
  const data = await getForgePlatformData()
  return <ForgeObservatory data={data} />
}
