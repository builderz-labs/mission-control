import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = getDatabase()
  
  const { searchParams } = new URL(request.url)
  const months = parseInt(searchParams.get('months') || '12')
  
  // Calculate future date
  const futureDate = new Date()
  futureDate.setMonth(futureDate.getMonth() + months)
  
  const batches = db.prepare(`
    SELECT * FROM batch_codes 
    WHERE status = 'active' 
    AND expiry_date <= ?
    ORDER BY expiry_date ASC
  `).all(futureDate.toISOString().split('T')[0])
  
  return NextResponse.json({ batches })
}