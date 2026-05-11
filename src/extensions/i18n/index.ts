/**
 * Extension i18n loader — merged into the next-intl message bag by
 * `src/i18n/request.ts` (the 4th approved upstream-touch point per FORK.md).
 *
 * Each `src/extensions/i18n/locales/{locale}.json` file holds only the
 * extension-owned namespaces (currently `oapApprovals` and `litellmUsage`).
 * Keeping them here rather than appending to upstream `messages/{locale}.json`
 * means the upstream locale files stay byte-identical to
 * builderz-labs/mission-control — so `git rebase upstream/main` no longer
 * conflicts on every locale tweak.
 *
 * Adding a new extension namespace:
 *   1. Add the keys to `src/extensions/i18n/locales/en.json` first.
 *   2. Mirror the structure into the other 9 locales (scripts under
 *      `scripts/translate_extension_namespaces.py` automate this).
 *   3. Use it from your panel: `useTranslations('yourNamespace')`.
 */

import { locales } from '@/i18n/config'

export type ExtensionMessages = Record<string, Record<string, string>>

export async function loadExtensionMessages(locale: string): Promise<ExtensionMessages> {
  // Defensive: even though the current call site (src/i18n/request.ts) validates
  // locale against the allowlist before passing it in, exporting this function
  // means any future caller could pass an unvalidated string. Re-validate here so
  // a path-traversal attempt or unknown-locale string fails closed.
  if (!(locales as readonly string[]).includes(locale)) return {}
  try {
    const mod = await import(`./locales/${locale}.json`)
    return (mod.default ?? mod) as ExtensionMessages
  } catch {
    return {}
  }
}
