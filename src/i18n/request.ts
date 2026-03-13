import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { locales, type Locale, defaultLocale } from './config'

function detectLocaleFromHeader(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null
  const languages = acceptLanguage.split(',').map(l => l.split(';')[0].trim().toLowerCase())
  for (const lang of languages) {
    if (lang.startsWith('zh')) return 'zh'
    if (lang.startsWith('en')) return 'en'
  }
  return null
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const localeCookie = cookieStore.get('NEXT_LOCALE')?.value
  
  // Validate locale from cookie
  if (localeCookie && locales.includes(localeCookie as Locale)) {
    return {
      locale: localeCookie as Locale,
      messages: (await import(`../../messages/${localeCookie}.json`)).default,
    }
  }

  // Detect from Accept-Language header
  const headersList = await headers()
  const acceptLanguage = headersList.get('accept-language')
  const detectedLocale = detectLocaleFromHeader(acceptLanguage)
  
  const locale: Locale = detectedLocale || defaultLocale

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})