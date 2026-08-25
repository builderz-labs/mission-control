export const locales = ['en', 'zh', 'zh-tw', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'
export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  'zh-tw': '中文（台灣）',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
}
