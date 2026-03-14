import { NextResponse } from 'next/server';
import { SovereigntyPolicyService } from '@/lib/services/sovereignty-policy-service';
import { requireRole } from '@/lib/auth';

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const violations = await SovereigntyPolicyService.evaluateFleet();
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      violations,
      status: violations.length > 0 ? 'breached' : 'nominal',
      policyCount: 3, // Cost, Loop, Velocity
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
