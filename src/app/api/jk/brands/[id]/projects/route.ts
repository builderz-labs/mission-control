import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const brandId = parseInt(id, 10)
  if (isNaN(brandId)) return NextResponse.json({ error: 'Invalid brand id' }, { status: 400 })

  const db = getDatabase()

  // Union projects across all 4 service types
  const seoProjects = db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'seo' as service_type,
           sp.baseline_da, sp.baseline_sessions, sp.ai_visibility_score
    FROM hm_seo_projects sp
    JOIN projects p ON p.id = sp.project_id
    WHERE sp.brand_id = ? AND p.status = 'active'
    ORDER BY p.created_at DESC
  `).all(brandId)

  const socialProjects = db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'social' as service_type,
           sp.channels, sp.er_target, sp.monthly_post_target
    FROM hm_social_projects sp
    JOIN projects p ON p.id = sp.project_id
    WHERE sp.brand_id = ? AND p.status = 'active'
    ORDER BY p.created_at DESC
  `).all(brandId)

  const adsProjects = db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'ads' as service_type,
           ap.monthly_budget, ap.objective, ap.roas_target
    FROM hm_ads_projects ap
    JOIN projects p ON p.id = ap.project_id
    WHERE ap.brand_id = ? AND p.status = 'active'
    ORDER BY p.created_at DESC
  `).all(brandId)

  const websiteProjects = db.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, 'website' as service_type,
           wp.website_type, wp.platform, wp.handover_signed
    FROM hm_website_projects wp
    JOIN projects p ON p.id = wp.project_id
    WHERE wp.brand_id = ? AND p.status = 'active'
    ORDER BY p.created_at DESC
  `).all(brandId)

  // Get overdue milestones count per project
  const overdueMap = new Map<number, number>()
  const overdue = db.prepare(`
    SELECT project_id, COUNT(*) as cnt
    FROM hm_project_milestones
    WHERE status != 'completed' AND deadline < unixepoch()
    GROUP BY project_id
  `).all() as Array<{ project_id: number; cnt: number }>
  for (const row of overdue) overdueMap.set(row.project_id, row.cnt)

  const allProjects = [...seoProjects, ...socialProjects, ...adsProjects, ...websiteProjects]
    .map((p: any) => ({ ...p, overdue_count: overdueMap.get(p.id) ?? 0 }))

  return NextResponse.json({ projects: allProjects })
}
