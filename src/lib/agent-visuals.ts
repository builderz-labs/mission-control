export interface AgentVisualConfig {
  initials: string
  displayName: string
  color: string
  bgClass: string
  borderClass: string
  spriteFilter: string
  deskStyle: string
  deskProps: string[]
  idleAnimation?: string
  statusEmoji?: string
}

/** Lowercase, replace spaces and underscores with hyphens. */
function normalizeAgentName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '-')
}

/** Derive a simple numeric hash from a string (for fallback color generation). */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/** Generate a fallback config for unknown agents based on their name. */
function generateDefaultVisuals(normalized: string, originalName?: string): AgentVisualConfig {
  const name = normalized
  const hash = hashString(name || 'unknown')
  const hue = hash % 360
  const r = (hash >> 8) & 0xff
  const g = (hash >> 4) & 0xff
  const b = hash & 0xff
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`

  const parts = name.split('-').filter(Boolean)
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : (name.slice(0, 2) || '??').toUpperCase()

  return {
    initials,
    displayName: originalName || name || 'Unknown',
    color: hex,
    bgClass: `bg-[${hex}]`,
    borderClass: `border-[${hex}]/60`,
    spriteFilter: `hue-rotate(${hue}deg) saturate(1.1)`,
    deskStyle: 'desk-default',
    deskProps: ['monitor'],
  }
}

const AGENT_CONFIGS: Record<string, AgentVisualConfig> = {
  watson: {
    initials: 'W',
    displayName: 'Watson',
    color: '#b4befe',
    bgClass: 'bg-[#b4befe]',
    borderClass: 'border-[#b4befe]/60',
    spriteFilter: 'hue-rotate(240deg) saturate(1.2)',
    deskStyle: 'desk-executive',
    deskProps: ['rug', 'plant-left', 'plant-right'],
  },
  librarian: {
    initials: 'LB',
    displayName: 'Librarian',
    color: '#cba6f7',
    bgClass: 'bg-[#cba6f7]',
    borderClass: 'border-[#cba6f7]/60',
    spriteFilter: 'hue-rotate(270deg) saturate(1.3)',
    deskStyle: 'desk-study',
    deskProps: ['bookshelf', 'lamp'],
  },
  dispatch: {
    initials: 'DP',
    displayName: 'Dispatch',
    color: '#89b4fa',
    bgClass: 'bg-[#89b4fa]',
    borderClass: 'border-[#89b4fa]/60',
    spriteFilter: 'hue-rotate(215deg) saturate(1.1)',
    deskStyle: 'desk-ops',
    deskProps: ['radio', 'clipboard'],
  },
  dodo: {
    initials: 'DD',
    displayName: 'Dodo',
    color: '#f5c2e7',
    bgClass: 'bg-[#f5c2e7]',
    borderClass: 'border-[#f5c2e7]/60',
    spriteFilter: 'hue-rotate(320deg) saturate(1.4)',
    deskStyle: 'desk-cozy',
    deskProps: ['cushion', 'mug'],
  },
  condor: {
    initials: 'CO',
    displayName: 'Condor',
    color: '#74c7ec',
    bgClass: 'bg-[#74c7ec]',
    borderClass: 'border-[#74c7ec]/60',
    spriteFilter: 'hue-rotate(195deg) saturate(1.2)',
    deskStyle: 'desk-lookout',
    deskProps: ['binoculars', 'map'],
  },
  compass: {
    initials: 'CP',
    displayName: 'Compass',
    color: '#94e2d5',
    bgClass: 'bg-[#94e2d5]',
    borderClass: 'border-[#94e2d5]/60',
    spriteFilter: 'hue-rotate(170deg) saturate(1.1)',
    deskStyle: 'desk-navigator',
    deskProps: ['globe', 'compass-rose'],
  },
  builder: {
    initials: 'BL',
    displayName: 'Builder',
    color: '#a6e3a1',
    bgClass: 'bg-[#a6e3a1]',
    borderClass: 'border-[#a6e3a1]/60',
    spriteFilter: 'hue-rotate(120deg) saturate(1.3)',
    deskStyle: 'desk-workshop',
    deskProps: ['toolbox', 'blueprints'],
  },
  'knowing-gnome': {
    initials: 'KG',
    displayName: 'Knowing Gnome',
    color: '#f9e2af',
    bgClass: 'bg-[#f9e2af]',
    borderClass: 'border-[#f9e2af]/60',
    spriteFilter: 'hue-rotate(40deg) saturate(1.2)',
    deskStyle: 'desk-mystic',
    deskProps: ['crystal-ball', 'scroll'],
  },
  producer: {
    initials: 'PR',
    displayName: 'Producer',
    color: '#fab387',
    bgClass: 'bg-[#fab387]',
    borderClass: 'border-[#fab387]/60',
    spriteFilter: 'hue-rotate(25deg) saturate(1.3) brightness(1.05)',
    deskStyle: 'desk-studio',
    deskProps: ['camera', 'microphone'],
  },
}

/**
 * Get visual configuration for an agent by name.
 * Returns a known config or generates a deterministic fallback.
 */
export function getAgentVisuals(name: string): AgentVisualConfig {
  const normalized = normalizeAgentName(name)
  if (Object.hasOwn(AGENT_CONFIGS, normalized)) {
    return AGENT_CONFIGS[normalized]
  }
  return generateDefaultVisuals(normalized, name)
}

/** Return sorted list of all known agent names. */
export function getAllKnownAgentNames(): string[] {
  return Object.keys(AGENT_CONFIGS).sort()
}
