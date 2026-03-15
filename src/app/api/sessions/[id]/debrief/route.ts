import { NextRequest, NextResponse } from 'next/server';
import { generateMissionDebrief } from '@/lib/services/mission-debrief-service';
import { requireRole } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const debrief = await generateMissionDebrief(id);
    
    if (!debrief) {
      return NextResponse.json({ error: 'Debrief not found' }, { status: 404 });
    }

    return NextResponse.json(debrief);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch debrief' }, { status: 500 });
  }
}
