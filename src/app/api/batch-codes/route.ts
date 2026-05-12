import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = getDatabase()
  
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') || ''
  const status = searchParams.get('status')
  const expiryFilter = searchParams.get('expiryWithinMonths')
  
  let sql = 'SELECT * FROM batch_codes WHERE 1=1'
  const params: any[] = []
  
  if (query) {
    sql += ' AND (product_code LIKE ? OR product_description LIKE ? OR batch_code LIKE ?)'
    const q = `%${query}%`
    params.push(q, q, q)
  }
  
  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  
  if (expiryFilter) {
    const months = parseInt(expiryFilter)
    const futureDate = new Date()
    futureDate.setMonth(futureDate.getMonth() + months)
    sql += ' AND expiry_date <= ? AND status = ?'
    params.push(futureDate.toISOString().split('T')[0], 'active')
  }
  
  sql += ' ORDER BY uploaded_at DESC'
  
  const batches = db.prepare(sql).all(...params)
  
  return NextResponse.json({ batches })
}

export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = getDatabase()
  
  const body = await request.json()
  const { id, status } = body
  
  if (!id || !status) {
    return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
  }
  
  const retiredAt = status === 'retired' ? new Date().toISOString() : null
  
  db.prepare(`
    UPDATE batch_codes 
    SET status = ?, retired_at = ?
    WHERE id = ?
  `).run(status, retiredAt, id)
  
  return NextResponse.json({ success: true })
}