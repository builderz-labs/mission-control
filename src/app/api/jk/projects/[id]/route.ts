import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const db = getDatabase()

  const base = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<string, any> | undefined
  if (!base) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const milestones = db.prepare(`
    SELECT * FROM hm_project_milestones WHERE project_id = ? ORDER BY deadline ASC, id ASC
  `).all(projectId)

  // Try each service type
  const seo = db.prepare(`SELECT * FROM hm_seo_projects WHERE project_id = ?`).get(projectId) as Record<string, any> | null
  if (seo) {
    const keywords = db.prepare(`SELECT * FROM hm_seo_keywords WHERE project_id = ? ORDER BY cluster, keyword`).all(projectId)
    return NextResponse.json({ project: base, service_type: 'seo', seo, keywords, milestones })
  }

  const social = db.prepare(`SELECT * FROM hm_social_projects WHERE project_id = ?`).get(projectId) as Record<string, any> | null
  if (social) {
    const posts = db.prepare(`
      SELECT * FROM hm_social_posts WHERE project_id = ? ORDER BY scheduled_date ASC, id ASC LIMIT 100
    `).all(projectId)
    return NextResponse.json({ project: base, service_type: 'social', social, posts, milestones })
  }

  const ads = db.prepare(`SELECT * FROM hm_ads_projects WHERE project_id = ?`).get(projectId) as Record<string, any> | null
  if (ads) {
    const campaigns = db.prepare(`
      SELECT * FROM hm_ads_campaigns WHERE ads_project_id = ? ORDER BY date_start DESC, id ASC
    `).all(projectId)
    return NextResponse.json({ project: base, service_type: 'ads', ads, campaigns, milestones })
  }

  const website = db.prepare(`SELECT * FROM hm_website_projects WHERE project_id = ?`).get(projectId) as Record<string, any> | null
  if (website) {
    return NextResponse.json({ project: base, service_type: 'website', website, milestones })
  }

  // Generic project without service extension
  return NextResponse.json({ project: base, service_type: null, milestones })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const body = await req.json()
  const db = getDatabase()

  // Update service-specific fields if provided
  if (body.seo) {
    const { baseline_da, baseline_sessions, baseline_avg_position, baseline_indexed_pages, ai_visibility_score } = body.seo
    db.prepare(`
      UPDATE hm_seo_projects
      SET baseline_da = COALESCE(?, baseline_da),
          baseline_sessions = COALESCE(?, baseline_sessions),
          baseline_avg_position = COALESCE(?, baseline_avg_position),
          baseline_indexed_pages = COALESCE(?, baseline_indexed_pages),
          ai_visibility_score = COALESCE(?, ai_visibility_score),
          updated_at = unixepoch()
      WHERE project_id = ?
    `).run(baseline_da ?? null, baseline_sessions ?? null, baseline_avg_position ?? null,
           baseline_indexed_pages ?? null, ai_visibility_score ?? null, projectId)
  }

  if (body.social) {
    const { brand_voice, target_audience, tone, monthly_post_target, er_target } = body.social
    db.prepare(`
      UPDATE hm_social_projects
      SET brand_voice = COALESCE(?, brand_voice),
          target_audience = COALESCE(?, target_audience),
          tone = COALESCE(?, tone),
          monthly_post_target = COALESCE(?, monthly_post_target),
          er_target = COALESCE(?, er_target),
          updated_at = unixepoch()
      WHERE project_id = ?
    `).run(brand_voice ?? null, target_audience ?? null, tone ?? null,
           monthly_post_target ?? null, er_target ?? null, projectId)
  }

  if (body.ads) {
    const { monthly_budget, objective, roas_target, cpa_target, leads_target } = body.ads
    db.prepare(`
      UPDATE hm_ads_projects
      SET monthly_budget = COALESCE(?, monthly_budget),
          objective = COALESCE(?, objective),
          roas_target = COALESCE(?, roas_target),
          cpa_target = COALESCE(?, cpa_target),
          leads_target = COALESCE(?, leads_target),
          updated_at = unixepoch()
      WHERE project_id = ?
    `).run(monthly_budget ?? null, objective ?? null, roas_target ?? null,
           cpa_target ?? null, leads_target ?? null, projectId)
  }

  if (body.website) {
    const { website_type, platform, hosting_provider, domain, handover_date, handover_signed } = body.website
    db.prepare(`
      UPDATE hm_website_projects
      SET website_type = COALESCE(?, website_type),
          platform = COALESCE(?, platform),
          hosting_provider = COALESCE(?, hosting_provider),
          domain = COALESCE(?, domain),
          handover_date = COALESCE(?, handover_date),
          handover_signed = COALESCE(?, handover_signed),
          updated_at = unixepoch()
      WHERE project_id = ?
    `).run(website_type ?? null, platform ?? null, hosting_provider ?? null,
           domain ?? null, handover_date ?? null, handover_signed ?? null, projectId)
  }

  return NextResponse.json({ success: true })
}
