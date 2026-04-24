import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id') ? parseInt(searchParams.get('brand_id')!, 10) : null
  const serviceType = searchParams.get('service_type')

  const db = getDatabase()

  const whereClause = brandId ? 'WHERE sp.brand_id = ? AND p.status = \'active\'' : 'WHERE p.status = \'active\''
  const args = brandId ? [brandId] : []

  const seoProjects = (!serviceType || serviceType === 'seo') ? db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'seo' as service_type,
           sp.brand_id, b.name as brand_name, c.name as client_name
    FROM hm_seo_projects sp
    JOIN projects p ON p.id = sp.project_id
    JOIN hm_brands b ON b.id = sp.brand_id
    JOIN hm_clients c ON c.id = b.client_id
    ${whereClause}
    ORDER BY p.created_at DESC
  `).all(...args) : []

  const socialProjects = (!serviceType || serviceType === 'social') ? db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'social' as service_type,
           sp.brand_id, b.name as brand_name, c.name as client_name,
           sp.er_target, sp.monthly_post_target
    FROM hm_social_projects sp
    JOIN projects p ON p.id = sp.project_id
    JOIN hm_brands b ON b.id = sp.brand_id
    JOIN hm_clients c ON c.id = b.client_id
    ${whereClause}
    ORDER BY p.created_at DESC
  `).all(...args) : []

  const adsProjects = (!serviceType || serviceType === 'ads') ? db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'ads' as service_type,
           ap.brand_id, b.name as brand_name, c.name as client_name,
           ap.monthly_budget, ap.roas_target
    FROM hm_ads_projects ap
    JOIN projects p ON p.id = ap.project_id
    JOIN hm_brands b ON b.id = ap.brand_id
    JOIN hm_clients c ON c.id = b.client_id
    ${whereClause}
    ORDER BY p.created_at DESC
  `).all(...args) : []

  const websiteProjects = (!serviceType || serviceType === 'website') ? db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'website' as service_type,
           wp.brand_id, b.name as brand_name, c.name as client_name,
           wp.handover_signed
    FROM hm_website_projects wp
    JOIN projects p ON p.id = wp.project_id
    JOIN hm_brands b ON b.id = wp.brand_id
    JOIN hm_clients c ON c.id = b.client_id
    ${whereClause}
    ORDER BY p.created_at DESC
  `).all(...args) : []

  // Overdue milestones per project
  const overdueRows = db.prepare(`
    SELECT project_id, COUNT(*) as cnt
    FROM hm_project_milestones
    WHERE status != 'completed' AND deadline < unixepoch()
    GROUP BY project_id
  `).all() as Array<{ project_id: number; cnt: number }>
  const overdueMap = new Map(overdueRows.map(r => [r.project_id, r.cnt]))

  const allProjects = [...seoProjects, ...socialProjects, ...adsProjects, ...websiteProjects]
    .map((p: any) => ({ ...p, overdue_count: overdueMap.get(p.id) ?? 0 }))
    .sort((a: any, b: any) => (b.overdue_count - a.overdue_count) || b.created_at - a.created_at)

  return NextResponse.json({ projects: allProjects })
}
