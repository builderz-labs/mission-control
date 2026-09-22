export interface SetupOption {
  value: string
  label: string
  consequence: string
  recommended?: boolean
}

export interface SetupQuestion {
  id: string
  title: string
  help: string
  options: SetupOption[]
}

export const setupQuestions: SetupQuestion[] = [
  {
    id: 'scope', title: 'Where should this setup apply?', help: 'Each repository is evaluated independently.',
    options: [
      { value: 'current', label: 'Current repository', consequence: 'Start safely with the repository already selected.', recommended: true },
      { value: 'selected', label: 'Selected repositories', consequence: 'Install the same reviewed policy in a chosen set.' },
      { value: 'all', label: 'All repositories', consequence: 'Install independently across every current repository.' },
      { value: 'standalone', label: 'Pasted context only', consequence: 'Do not load repository files; use the current repository only as the audit home.' },
    ],
  },
  {
    id: 'answerType', title: 'What kind of answer is most useful?', help: 'The assistant will keep each question atomic.',
    options: [
      { value: 'mixed', label: 'Recommend for me', consequence: 'Choose the smallest useful mix of Jev answer types.', recommended: true },
      { value: 'noul', label: 'Yes or no', consequence: 'Return the probability that one statement is true.' },
      { value: 'choice', label: 'Choose one', consequence: 'Compare probabilities across named options.' },
      { value: 'score', label: 'Rating scale', consequence: 'Return a weighted position on ordered levels.' },
    ],
  },
  {
    id: 'contextMode', title: 'What evidence may be used?', help: 'Credential files, environment files, dependencies, and raw source trees stay excluded.',
    options: [
      { value: 'safe_repository', label: 'Safe repository snapshot', consequence: 'Use bounded metadata, paths, and allowlisted docs/manifests.', recommended: true },
      { value: 'pasted', label: 'Only what I paste', consequence: 'Send no repository snapshot.' },
      { value: 'metadata_only', label: 'Metadata only', consequence: 'Use project name, purpose, and repository identity only.' },
    ],
  },
  {
    id: 'enforcement', title: 'How should results affect work?', help: 'Blocking should follow a measured shadow period.',
    options: [
      { value: 'advisory', label: 'Advisory', consequence: 'Show evidence and next steps without stopping work.', recommended: true },
      { value: 'review', label: 'Require human review', consequence: 'Flag uncertain or risky results for approval.' },
      { value: 'blocking', label: 'Blocking gate', consequence: 'Reserve for calibrated policies with representative tests.' },
    ],
  },
  {
    id: 'trigger', title: 'When should it run?', help: 'The initial release saves configuration; automation can be connected after a sample succeeds.',
    options: [
      { value: 'manual', label: 'Manually', consequence: 'Run only when an operator chooses context and confirms.', recommended: true },
      { value: 'pull_request', label: 'Pull request', consequence: 'Prepare for a PR-triggered review.' },
      { value: 'ci', label: 'CI check', consequence: 'Prepare for an automated build check.' },
      { value: 'release', label: 'Release gate', consequence: 'Prepare for a pre-release decision.' },
    ],
  },
  {
    id: 'failureMode', title: 'What if the provider is unavailable?', help: 'Mission Control never invents a successful result.',
    options: [
      { value: 'retry_then_review', label: 'Retry, then review', consequence: 'Retry once and ask a human if it still fails.', recommended: true },
      { value: 'hold_for_review', label: 'Hold immediately', consequence: 'Stop and require an operator decision.' },
      { value: 'skip_and_continue', label: 'Skip and continue', consequence: 'Record the failure and continue other repositories.' },
    ],
  },
  {
    id: 'validation', title: 'How thoroughly should we validate it?', help: 'This controls the proposed test, risk, and observability plan.',
    options: [
      { value: 'full', label: 'Production-ready checks', consequence: 'Include contracts, adversarial cases, failure paths, and monitoring.', recommended: true },
      { value: 'sample', label: 'One safe sample', consequence: 'Prove the workflow before expanding.' },
      { value: 'basic', label: 'Basic contract checks', consequence: 'Validate schema and happy-path behavior only.' },
    ],
  },
]

export const recommendedAnswers = Object.fromEntries(setupQuestions.map((question) => [
  question.id,
  question.options.find((option) => option.recommended)?.value ?? question.options[0].value,
]))
