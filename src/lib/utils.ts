import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Normalize model field — OpenClaw 2026.3.x may send {primary: "model-name"} instead of a string */
export function normalizeModel(model: unknown): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object' && 'primary' in model) return String((model as any).primary)
  return ''
}
