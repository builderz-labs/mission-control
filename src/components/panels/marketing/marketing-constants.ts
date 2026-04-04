import type { DesignAgent, Phase, QuickStart } from './marketing-types'

export const DESIGN_AGENTS: DesignAgent[] = [
  {
    id: 'trend-synth', name: 'Trend Synthesizer', handle: '@TrendSynth',
    role: 'Researches and synthesizes market trends and competitive intelligence',
    trigger: '/trend-report', color: 'hsl(var(--void-cyan))',
    outputs: ['Trend reports', 'Competitive analysis', 'Opportunity map'],
    phase: 'discovery',
  },
  {
    id: 'brand-identity', name: 'Brand Identity Creator', handle: '@BrandIdentity',
    role: 'Develops comprehensive brand identity systems from scratch',
    trigger: '/brand-create', color: 'hsl(var(--void-violet))',
    outputs: ['Logo concepts', 'Color system', 'Typography guide', 'Brand voice'],
    phase: 'strategy',
  },
  {
    id: 'design-system', name: 'Design System Architect', handle: '@DesignSystem',
    role: 'Creates scalable design systems with tokens and components',
    trigger: '/design-system', color: 'hsl(var(--void-mint))',
    outputs: ['Design tokens', 'Component library', 'Usage guidelines'],
    phase: 'system',
  },
  {
    id: 'marketing-asset', name: 'Marketing Asset Factory', handle: '@MarketingAssets',
    role: 'Creates marketing collateral from brand assets',
    trigger: '/marketing-assets', color: 'hsl(var(--void-amber))',
    outputs: ['Social templates', 'Ad creatives', 'Email templates'],
    phase: 'application',
  },
  {
    id: 'presentation', name: 'Presentation Designer', handle: '@PresentationDesigner',
    role: 'Builds cinematic pitch decks and presentations via Gamma',
    trigger: '/create-deck', color: 'hsl(var(--success))',
    outputs: ['Pitch deck', 'Keynote slides', 'Data visualizations'],
    phase: 'application',
  },
  {
    id: 'critique', name: 'Critique Partner', handle: '@CritiquePartner',
    role: 'Provides expert design critique and improvement suggestions',
    trigger: '/critique', color: 'hsl(var(--warning))',
    outputs: ['Design review', 'Improvement roadmap', 'Priority fixes'],
    phase: 'launch',
  },
  {
    id: 'accessibility', name: 'Accessibility Auditor', handle: '@A11yAuditor',
    role: 'Ensures WCAG compliance and inclusive design',
    trigger: '/a11y-audit', color: 'hsl(var(--info))',
    outputs: ['WCAG report', 'Color contrast fixes', 'Screen reader notes'],
    phase: 'launch',
  },
]

export const PHASES: Phase[] = [
  { id: 'discovery', label: 'Discovery', color: 'hsl(var(--void-cyan))' },
  { id: 'strategy', label: 'Strategy', color: 'hsl(var(--void-violet))' },
  { id: 'system', label: 'System', color: 'hsl(var(--void-mint))' },
  { id: 'application', label: 'Application', color: 'hsl(var(--void-amber))' },
  { id: 'launch', label: 'Launch', color: 'hsl(var(--warning))' },
]

export const QUICK_STARTS: QuickStart[] = [
  {
    label: 'Investor Pitch',
    prompt: 'Create a compelling investor pitch deck for a SaaS startup. Include problem, solution, market size, traction, team, and funding ask slides.',
    format: 'presentation',
    numCards: 12,
    icon: '💰',
  },
  {
    label: 'Product Launch',
    prompt: 'Design a product launch presentation highlighting key features, customer benefits, pricing, and go-to-market strategy.',
    format: 'presentation',
    numCards: 10,
    icon: '🚀',
  },
  {
    label: 'Sales Deck',
    prompt: 'Build a persuasive sales deck with value proposition, case studies, ROI calculator, and clear call to action.',
    format: 'presentation',
    numCards: 8,
    icon: '📊',
  },
  {
    label: 'Brand Story',
    prompt: 'Tell our brand story with mission, vision, founding story, values, and the impact we are creating in the world.',
    format: 'presentation',
    numCards: 8,
    icon: '✨',
  },
  {
    label: 'Case Study',
    prompt: 'Write a detailed case study document covering the challenge, solution, implementation, results, and testimonials.',
    format: 'document',
    numCards: 6,
    icon: '📄',
  },
  {
    label: 'Social Campaign',
    prompt: 'Create a social media content series for a product launch with engaging hooks, visuals descriptions, and CTAs.',
    format: 'social',
    numCards: 5,
    icon: '📱',
  },
]

export const DIMENSION_OPTIONS = [
  { value: '16x9', label: '16:9 — Widescreen' },
  { value: '4x3', label: '4:3 — Standard' },
  { value: 'fluid', label: 'Fluid' },
  { value: '4x5', label: '4:5 — Instagram' },
  { value: '9x16', label: '9:16 — Stories' },
]

export const FORMAT_LABELS: Record<string, string> = {
  presentation: 'Presentation',
  document: 'Document',
  social: 'Social Post',
  webpage: 'Web Page',
}
