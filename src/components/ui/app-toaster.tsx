'use client'

import { useTheme } from 'next-themes'
import { Toaster } from 'sonner'
import { isThemeDark } from '@/lib/themes'

/**
 * Theme-aware Sonner host. Mount once under ThemeProvider (see root layout).
 */
export function AppToaster() {
  const { theme, resolvedTheme } = useTheme()
  const id = resolvedTheme || theme || 'void'
  const sonnerTheme = isThemeDark(id) ? 'dark' : 'light'

  return (
    <Toaster
      theme={sonnerTheme}
      richColors
      closeButton
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'font-sans',
        },
      }}
    />
  )
}
