import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

export async function GET() {
  const db = getDatabase();
  const approvals = db
    .prepare('SELECT id, email, scope, expires_at, created_at, requestor FROM oauth_approvals WHERE status = ? ORDER BY created_at DESC LIMIT 20')
    .all('pending');
  return NextResponse.json({ approvals });
}
