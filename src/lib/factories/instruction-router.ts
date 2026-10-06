import type { InstructionArea, InstructionExecutor, InstructionPlan, InstructionPlanStep } from './types'

const CLAUDE_CODE_AVAILABLE = false

const patterns = {
  search: /\b(search|research|investigat|look up|find sources|competitive analysis)\b|検索|調査|リサーチ/i,
  marketing: /\b(marketing|content|campaign|copy|brand|social|shufuro)\b|マーケ|コンテンツ|広告|集客|シュフロ/i,
  creative: /\b(video|creative|reel|shorts?|render|storyboard|thumbnail|visual)\b|動画|映像|クリエイティブ|制作|編集|レンダー/i,
  dev: /\b(code|implement|build|fix|repair|refactor|test|bug|software)\b|実装|開発|修正|修復|コード|テスト/i,
  publish: /\b(publish(?:ing|ed)?|post|upload|deploy|release|push|send|email|account settings?|payment|purchase|charge|delete production|remove production data)\b|公開|投稿|アップロード|デプロイ|リリース|送信|メール|アカウント設定|設定変更|支払い|購入|決済|本番データ削除/i,
  implementation: /\b(implement|build|fix|repair|refactor|code|bug)\b|実装|開発|修正|修復|リファクタ|コード|バグ/i,
  complex: /\b(complex|high[- ]risk|architecture|restructure|migration|rewrite|large[- ]scale)\b|複雑|高リスク|アーキテクチャ|大規模改修|再構築|全面改修/i,
  deterministic: /\b(run|execute|render|test|check|lint|format|read|inspect|summari[sz]e)\b|実行|レンダー|テスト|確認|検査|読む|調査|要約/i,
}

function chooseExecutor(goal: string, area: InstructionArea): InstructionExecutor {
  if (area === 'dev' && patterns.implementation.test(goal)) {
    return patterns.complex.test(goal) ? 'codex-high' : 'codex-medium'
  }
  if (patterns.deterministic.test(goal) || !patterns.implementation.test(goal)) return 'deterministic'
  return 'codex-medium'
}

function step(area: InstructionArea, objective: string, executor: InstructionExecutor): InstructionPlanStep {
  return {
    id: area,
    area,
    objective,
    executor,
    executor_available: executor !== 'claude-code',
    status: 'planned',
    requires_human_approval: false,
  }
}

/** Deterministically turns a goal into a proposed plan. It never invokes an executor or performs side effects. */
export function routeInstruction(goal: string): InstructionPlan {
  const normalized = goal.trim()
  const shufuro = /shufuro|シュフロ/i.test(normalized)
  const wantsCreative = patterns.creative.test(normalized) || shufuro
  const wantsMarketing = patterns.marketing.test(normalized) || shufuro
  const areas: InstructionArea[] = []

  if (patterns.search.test(normalized)) areas.push('search')
  if (wantsMarketing) areas.push('marketing')
  if (wantsCreative) areas.push('creative-video')
  if (patterns.dev.test(normalized)) areas.push('dev')
  if (areas.length === 0) areas.push('search')

  const objectives: Record<InstructionArea, string> = {
    search: 'Research the goal, relevant context, and evidence needed for the next step.',
    marketing: 'Resolve the marketing and content direction, audience, and message.',
    'creative-video': 'Create the video or creative assets, then render and perform quality checks.',
    dev: 'Implement or repair the bounded code change and run the relevant checks.',
  }
  const steps = areas.map((area) => step(area, objectives[area], chooseExecutor(normalized, area)))
  const mentionsExternalAction = patterns.publish.test(normalized)
  const preExternalBoundary = /\bbefore\s+(?:publish(?:ing|ed)?|post(?:ing|ed)?|upload(?:ing|ed)?|deploy(?:ing|ed)?|release|push(?:ing|ed)?|send(?:ing|sent)?)\b|公開前|投稿前|アップロード前|デプロイ前|リリース前|送信前/i.test(normalized)
  const externalAction = mentionsExternalAction && !preExternalBoundary
  if (preExternalBoundary && steps.length > 0) {
    const finalStep = steps[steps.length - 1]
    finalStep.status = 'requires-human-approval'
    finalStep.requires_human_approval = true
    finalStep.approval_reason = 'Human review is required after preparation and before any external side effect.'
  } else if (externalAction) {
    steps.push({
      id: 'human-approval', area: areas[areas.length - 1],
      objective: 'Pause for explicit human approval before the requested external side effect.',
      executor: 'deterministic', executor_available: true, status: 'requires-human-approval',
      requires_human_approval: true,
      approval_reason: 'Publishing, deployment, delivery, account changes, payment, or another external side effect requires human approval.',
    })
  }

  return {
    goal: normalized,
    steps,
    requires_human_approval: mentionsExternalAction,
    executor_availability: {
      deterministic: true,
      'codex-medium': true,
      'codex-high': true,
      'claude-code': CLAUDE_CODE_AVAILABLE,
    },
    notes: ['Planning only: no commands, network calls, persistence, or external actions are performed.', 'Claude Code is not connected and is unavailable as an executor.'],
  }
}
