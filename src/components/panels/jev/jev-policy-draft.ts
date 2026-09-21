import type { JevPolicy, JevQuestions } from './jev-ui-types'

export type DraftType = 'noul' | 'choice' | 'score'
export interface QuestionDraft {
  id: string
  type: DraftType
  instructions: string
  criteria: string
  positive: string
  negative: string
}

export const emptyQuestion = (): QuestionDraft => ({
  id: 'question', type: 'noul', instructions: '', criteria: '', positive: '', negative: '',
})

function printable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function draftFromPolicy(policy?: JevPolicy | null): QuestionDraft[] {
  if (!policy) return [emptyQuestion()]
  return draftsFromQuestions(policy.questions)
}

export function draftsFromQuestions(questions: JevQuestions): QuestionDraft[] {
  return Object.entries(questions).map(([id, question]) => {
    if (question.type === 'choice') {
      return {
        id, type: 'choice', instructions: printable(question.instructions),
        criteria: Object.entries(question.criteria).map(([key, value]) => `${key}: ${printable(value)}`).join('\n'),
        positive: '', negative: '',
      }
    }
    if (question.type === 'score') {
      const values = Array.isArray(question.criteria)
        ? question.criteria
        : Object.keys(question.criteria).sort().map((key) => question.criteria[Number(key)])
      return {
        id, type: 'score', instructions: printable(question.instructions),
        criteria: values.map(printable).join('\n'), positive: '', negative: '',
      }
    }
    return {
      id, type: 'noul', instructions: printable(question.instructions), criteria: '',
      positive: printable(question.criteria?.true ?? ''),
      negative: printable(question.criteria?.false ?? ''),
    }
  })
}

export function questionsFromDrafts(drafts: QuestionDraft[]): JevQuestions {
  return Object.fromEntries(drafts.map((draft) => {
    const id = draft.id.trim()
    const instructions = draft.instructions.trim()
    if (draft.type === 'choice') {
      const criteria = Object.fromEntries(draft.criteria.split('\n').filter(Boolean).map((line) => {
        const split = line.indexOf(':')
        if (split < 1) throw new Error('Choice options must use “key: description”')
        return [line.slice(0, split).trim(), line.slice(split + 1).trim() || null]
      }))
      if (Object.keys(criteria).length < 2) throw new Error('Choice questions need at least two options')
      return [id, { type: 'choice', instructions, criteria }]
    }
    if (draft.type === 'score') {
      const criteria = draft.criteria.split('\n').map((line) => line.trim()).filter(Boolean)
      if (criteria.length < 2) throw new Error('Score questions need at least two levels')
      return [id, { type: 'score', instructions, criteria: criteria as [string, ...string[]] }]
    }
    const criteria = draft.positive.trim() || draft.negative.trim()
      ? { true: draft.positive.trim() || null, false: draft.negative.trim() || null }
      : undefined
    return [id, { type: 'noul', instructions, criteria }]
  })) as JevQuestions
}
