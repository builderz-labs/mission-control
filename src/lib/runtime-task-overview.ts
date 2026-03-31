type RuntimeLikeTask = {
  id: number
  title: string
  status: string
  assigned_to?: string | null
  metadata?: Record<string, unknown> | null
}

export interface RuntimeTaskOverview {
  id: number
  title: string
  assignedTo: string | null
  status: string
  summary: string
  facts: string[]
  tone: 'neutral' | 'good' | 'warn' | 'danger'
}

function toneForStatus(status: string): RuntimeTaskOverview['tone'] {
  if (status === 'done') return 'good'
  if (status === 'review' || status === 'quality_review') return 'danger'
  if (status === 'awaiting_owner' || status === 'in_progress') return 'warn'
  return 'neutral'
}

function slotLabels(slots: unknown): string[] {
  if (!Array.isArray(slots)) return []
  return slots
    .map((slot) => String(slot))
    .map((slot) => {
      const match = slot.match(/T(\d{2}:\d{2})/)
      return match?.[1] || slot
    })
}

function collapseWhitespace(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function shortenFact(value: unknown, maxLength = 120): string {
  const collapsed = collapseWhitespace(value)
  if (!collapsed) return ''
  const firstSentence = collapsed.split(/(?<=[.!?])\s+/)[0] || collapsed
  if (firstSentence.length <= maxLength) return firstSentence
  return `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
}

function growthPlatformSummary(platform: 'YouTube' | 'X', status: unknown, note: unknown): string {
  const normalizedStatus = String(status || 'missing')
  const normalizedNote = collapseWhitespace(note).toLowerCase()
  if (normalizedStatus === 'completed' && normalizedNote.includes('private draft')) return `${platform} private draft ready`
  if (normalizedStatus === 'completed') return `${platform} completed`
  if (normalizedStatus === 'failed') return `${platform} retry needed`
  if (normalizedStatus === 'missing') return `${platform} missing`
  return `${platform} ${normalizedStatus}`
}

export function buildRuntimeTaskOverview(task: RuntimeLikeTask): RuntimeTaskOverview {
  const metadata = task.metadata || {}
  const runtimeSource = String(metadata.runtimeSource || '')
  const facts: string[] = []
  let summary = task.status

  if (runtimeSource === 'hh_daily_status') {
    const reservedToday = Number(metadata.reservedToday || 0)
    const publishedToday = Number(metadata.publishedToday || 0)
    const quotaTarget = Math.max(1, Number(metadata.quotaTarget || 3))
    const completedToday = Math.min(quotaTarget, publishedToday + reservedToday)
    const slots = slotLabels(metadata.availableSlots)
    const failures = Array.isArray(metadata.failures) ? metadata.failures.map(String) : []
    summary = `완료 ${completedToday}/${quotaTarget}, 남은 슬롯 ${slots.length}개`
    if (publishedToday > 0) facts.push(`게시 ${publishedToday}건`)
    if (reservedToday > 0) facts.push(`예약 ${reservedToday}건`)
    if (slots.length > 0) facts.push(`남은 슬롯: ${slots.join(', ')}`)
    if (failures.length > 0) facts.push(`실패: ${failures.join(', ')}`)
  } else if (runtimeSource === 'daily_us_stock_news') {
    const sendSuccess = Boolean(metadata.sendSuccess)
    const dryRun = Boolean(metadata.dryRun)
    const latestRunAt = metadata.latestRunAt ? String(metadata.latestRunAt) : 'none'
    const articleCount = Number(metadata.articleCount || 0)
    if (dryRun) {
      summary = '드라이런만 완료'
    } else if (task.status === 'done' && sendSuccess) {
      summary = '최근 전송 성공'
    } else if (task.status === 'assigned') {
      summary = '오늘 15:00 대기'
    } else if (task.status === 'awaiting_owner') {
      summary = '전송 필요/실패'
    } else {
      summary = sendSuccess ? '전송 상태 확인 필요' : '최근 전송 대기/실패'
    }
    facts.push(`최근 실행: ${latestRunAt}`)
    facts.push(`기사 ${articleCount}건`)
    if (dryRun) facts.push('드라이런')
  } else if (runtimeSource === 'growth_uploads') {
    const youtubeStatus = String(metadata.youtubeStatus || 'missing')
    const xStatus = String(metadata.xStatus || 'missing')
    const youtubeSlug = metadata.youtubeSlug ? String(metadata.youtubeSlug) : ''
    const xSlug = metadata.xSlug ? String(metadata.xSlug) : ''
    const youtubeNote = collapseWhitespace(metadata.youtubeNote)
    const xNote = shortenFact(metadata.xNote)
    const youtubeTransport = collapseWhitespace(metadata.youtubeTransport)
    const xTransport = collapseWhitespace(metadata.xTransport)
    const youtubeApprovalStatus = collapseWhitespace(metadata.youtubeApprovalStatus)
    const xApprovalStatus = collapseWhitespace(metadata.xApprovalStatus)
    summary = `${growthPlatformSummary('YouTube', youtubeStatus, youtubeNote)} / ${growthPlatformSummary('X', xStatus, xNote)}`
    if (youtubeSlug) facts.push(`YouTube: ${youtubeSlug}`)
    if (youtubeTransport || youtubeApprovalStatus) {
      facts.push(`YouTube 경로: ${[youtubeTransport, youtubeApprovalStatus].filter(Boolean).join(' · ')}`)
    }
    if (xNote && xStatus === 'failed') {
      facts.push(`X 이슈: ${xNote}`)
    } else if (xSlug) {
      facts.push(`X: ${xSlug}`)
    }
    if (!facts.some((fact) => fact.startsWith('X:')) && xSlug) facts.push(`X: ${xSlug}`)
    if ((xTransport || xApprovalStatus) && xStatus !== 'failed') {
      facts.push(`X 경로: ${[xTransport, xApprovalStatus].filter(Boolean).join(' · ')}`)
    }
  } else if (runtimeSource === 'biz_report') {
    const reviewQueue = Number(metadata.humanReviewQueue || 0)
    const briefCount = Number(metadata.briefCount || 0)
    const proposalCount = Number(metadata.proposalCount || 0)
    summary = reviewQueue > 0 ? `검토 대기 ${reviewQueue}건` : `브리프 ${briefCount} / 제안 ${proposalCount}`
    facts.push(`브리프 ${briefCount}건`)
    facts.push(`제안 ${proposalCount}건`)
  }

  return {
    id: task.id,
    title: task.title,
    assignedTo: task.assigned_to || null,
    status: task.status,
    summary,
    facts,
    tone: toneForStatus(task.status),
  }
}

export function buildRuntimeTaskOverviews(tasks: RuntimeLikeTask[]): RuntimeTaskOverview[] {
  return tasks
    .filter((task) => Boolean(task?.metadata?.runtimeDerived))
    .map(buildRuntimeTaskOverview)
}
