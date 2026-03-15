import { NextResponse } from 'next/server'
import { clusterManager } from '@/lib/cluster-manager'
import { requireRole } from '@/lib/auth'

export async function POST(req: Request) {
  const auth = requireRole(req, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { node_id, url } = await req.json()
    if (!node_id || !url) throw new Error('Invalid heartbeat payload')
    
    clusterManager.heartbeat(node_id, url)
    
    return NextResponse.json({ 
      success: true, 
      peers: clusterManager.getPeers().length,
      timestamp: Date.now()
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'online',
    node_id: process.env.NODE_ID || 'master',
    peers: clusterManager.getPeers()
  })
}
