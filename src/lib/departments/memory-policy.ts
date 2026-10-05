import { DEPARTMENT_IDS, type DepartmentId } from './registry'

export interface DepartmentMemoryPolicy {
  department: DepartmentId
  provider: 'skillmem'
  mode: 'READ_ONLY_ACTIVE'
  recall_before_nontrivial_task: true
  direct_agent_write: false
  recall_terms: string[]
  durable_brain_path: string
  promotion_path: string[]
  reinforcement_requires_external_evidence: true
}

const terms: Record<DepartmentId, string[]> = {
  product: ['product', 'jtbd', 'discovery', 'activation', 'retention'],
  engineering: ['engineering', 'tests', 'build', 'regression', 'release', 'rollback'],
  marketing: ['marketing', 'positioning', 'channel', 'hook', 'offer', 'copy', 'measurement'],
  'creative-video': ['creative', 'video', 'hook', 'retention', 'storyboard', 'editing', 'packaging'],
  growth: ['growth', 'funnel', 'experiment', 'activation', 'retention', 'conversion'],
  'voc-research': ['voc', 'research', 'interview', 'cluster', 'language', 'evidence'],
  'revenue-sales': ['revenue', 'sales', 'pricing', 'offer', 'objection', 'conversion', 'churn'],
  'operations-control-tower': ['operations', 'routing', 'approval', 'cost', 'evidence', 'rollback'],
}

export const departmentMemoryPolicy: readonly DepartmentMemoryPolicy[] = DEPARTMENT_IDS.map((department) => ({
  department,
  provider: 'skillmem',
  mode: 'READ_ONLY_ACTIVE',
  recall_before_nontrivial_task: true,
  direct_agent_write: false,
  recall_terms: terms[department],
  durable_brain_path: `20 Areas/AI Company OS/Departments/${department}.md`,
  promotion_path: [
    'Control Tower evidence',
    'Improvement Candidate',
    'eval plan + rollback target',
    'independent review when required',
    'human promotion gate',
    'Obsidian Skill/Playbook',
    'optional future skillmem trusted import',
  ],
  reinforcement_requires_external_evidence: true,
}))

export function getDepartmentMemoryPolicy(id: DepartmentId): DepartmentMemoryPolicy {
  const policy = departmentMemoryPolicy.find((item) => item.department === id)
  if (!policy) throw new Error(`Unknown department memory policy: ${id}`)
  return policy
}
