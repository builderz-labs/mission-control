import type { Metadata } from 'next'
import { ForgeControlCenter } from '@/components/forge/forge-control-center'
import { getForgePlatformData } from '@/lib/forge/platform-data'

export const metadata: Metadata = {
  title: 'Marcuzx Forge Control',
  description: 'Control center MVP for the Marcuzx Forge platform.',
}

export const revalidate = 60

export default async function ForgePage() {
  const data = await getForgePlatformData()
  return <ForgeControlCenter data={data} />
}
