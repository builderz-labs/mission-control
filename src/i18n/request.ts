import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { locales, defaultLocale, type Locale } from './config'
// ─── Extension i18n (@stroupaloop/mission-control fork) ─────────────────────
// Merges extension-owned namespaces (e.g. oapApprovals, litellmUsage) loaded
// from `src/extensions/i18n/{locale}.json` so the upstream messages/*.json
// files stay byte-identical to builderz-labs/mission-control. Approved
// upstream-touch point per FORK.md.
import { loadExtensionMessages } from '@/extensions/i18n'
// ────────────────────────────────────────────────────────────────────────────

export default getRequestConfig(async () => {
  let locale: Locale = defaultLocale

  // 1. Check NEXT_LOCALE cookie
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value as Locale | undefined
  if (cookieLocale && locales.includes(cookieLocale)) {
    locale = cookieLocale
  } else {
    // 2. Fall back to Accept-Language header
    const headerStore = await headers()
    const acceptLang = headerStore.get('accept-language') || ''
    const preferred = acceptLang
      .split(',')
      .map((part) => part.split(';')[0].trim().substring(0, 2).toLowerCase())
      .find((code) => locales.includes(code as Locale))
    if (preferred) {
      locale = preferred as Locale
    }
  }

  const [upstreamMessages, extensionMessages] = await Promise.all([
    import(`../../messages/${locale}.json`).then((m) => m.default),
    loadExtensionMessages(locale),
  ])

  return {
    locale,
    messages: { ...upstreamMessages, ...extensionMessages },
  }
})
