import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getHermesTasks } from '@/lib/hermes-tasks'
import { listHermesProfiles } from '@/lib/hermes-sessions'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const force = request.nextUrl.searchParams.get('force') === 'true'
  
  try {
    const defaultResult = getHermesTasks(force)
    let allCronJobs = Array.isArray(defaultResult.cronJobs) ? [...defaultResult.cronJobs] : []

    const profiles = listHermesProfiles()
    for (const profile of profiles) {
      try {
        const profileResult = getHermesTasks(force, profile)
        if (profileResult && Array.isArray(profileResult.cronJobs)) {
          allCronJobs = [...allCronJobs, ...profileResult.cronJobs]
        }
      } catch (profileErr) {
        console.warn(`Failed to fetch tasks for profile ${profile}:`, profileErr)
      }
    }

    return NextResponse.json({ cronJobs: allCronJobs })
  } catch (err) {
    console.error('Failed to aggregate Hermes tasks:', err)
    return NextResponse.json({ error: 'Failed to aggregate tasks' }, { status: 500 })
  }
}
