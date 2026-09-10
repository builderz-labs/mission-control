import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { detectProviderSubscriptions } from './provider-subscriptions'

function envSet(...keys: string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()))
}

export function detectModelAccess(): Record<string, boolean> {
  const home = homedir()
  const subscribed = detectProviderSubscriptions().active
  return {
    anthropic: Boolean(subscribed.anthropic) || envSet('ANTHROPIC_API_KEY') || existsSync(join(home, '.claude')),
    openai: Boolean(subscribed.openai) || envSet('OPENAI_API_KEY') || existsSync(join(home, '.codex', 'auth.json')),
    moonshot: Boolean(subscribed.moonshot) || envSet('MOONSHOT_API_KEY') || existsSync(join(home, '.kimi-code')),
    xai: Boolean(subscribed.xai) || envSet('XAI_API_KEY') || existsSync(join(home, '.grok')),
    groq: envSet('GROQ_API_KEY'),
    google: envSet('GOOGLE_API_KEY', 'GEMINI_API_KEY'),
    minimax: envSet('MINIMAX_API_KEY'),
    venice: envSet('VENICE_API_KEY'),
    ollama: envSet('OLLAMA_API_KEY') || existsSync(join(home, '.ollama')),
    openrouter: envSet('OPENROUTER_API_KEY'),
  }
}
