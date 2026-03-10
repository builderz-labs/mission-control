import { NextResponse } from 'next/server'
import { getForgePlatformData } from '@/lib/forge/platform-data'

export async function GET() {
  const data = await getForgePlatformData()
  return NextResponse.json(data)
}
