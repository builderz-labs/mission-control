import { defineRouting } from 'next-intl/routing'
import { createNavigation } from 'next-intl/navigation'
import { locales, defaultLocale } from './config'

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'never', // Don't show /en or /zh in URL
})

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)