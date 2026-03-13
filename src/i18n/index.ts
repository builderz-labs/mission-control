import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { locales, type Locale } from './config'

export { locales, type Locale }
export { NextIntlClientProvider, getMessages }

export function validateLocale(locale: string | undefined): Locale {
  if (!locale || !locales.includes(locale as Locale)) {
    notFound()
  }
  return locale as Locale
}