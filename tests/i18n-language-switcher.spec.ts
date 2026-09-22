import { test, expect, Page } from '@playwright/test'

/**
 * E2E tests for i18n language switcher on the login page.
 * Verifies language selection, cookie persistence, and translation rendering.
 *
 * The language switcher sets a NEXT_LOCALE cookie and calls
 * window.location.reload(), so we set the cookie directly and navigate
 * to avoid race conditions with Playwright's selectOption + reload.
 */

async function switchLocale(page: Page, locale: string) {
  // Set the cookie directly (same as the switcher does)
  await page.context().addCookies([{
    name: 'NEXT_LOCALE',
    value: locale,
    path: '/',
    domain: new URL(page.url() || 'http://127.0.0.1:3005').hostname,
  }])
  await page.goto('/login', { waitUntil: 'load' })
}

test.describe('i18n Language Switcher', () => {
  test('login page renders English by default', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/login')

    await expect(page.getByText('Sign in to continue', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Username', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  })

  test('language switcher shows all 11 languages', async ({ page }) => {
    await page.goto('/login')

    const select = page.getByLabel('Language')
    await expect(select).toBeVisible()

    const options = await select.locator('option').allTextContents()
    expect(options).toHaveLength(11)
    expect(options).toContain('English')
    expect(options).toContain('中文')
    expect(options).toContain('中文（台灣）')
    expect(options).toContain('日本語')
    expect(options).toContain('한국어')
    expect(options).toContain('Español')
    expect(options).toContain('Français')
    expect(options).toContain('Deutsch')
    expect(options).toContain('Português')
    expect(options).toContain('Русский')
    expect(options).toContain('العربية')
  })

  test('Chinese locale renders Chinese translations', async ({ page }) => {
    await page.goto('/login')
    await switchLocale(page, 'zh')

    await expect(page.getByText('登录以继续', { exact: true })).toBeVisible()
    await expect(page.getByLabel('用户名', { exact: true })).toBeVisible()
    await expect(page.getByLabel('密码', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  })

  test('Traditional Chinese (Taiwan) locale renders zh-tw translations', async ({ page }) => {
    await page.goto('/login')
    await switchLocale(page, 'zh-tw')

    await expect(page.getByText('登入以繼續', { exact: true })).toBeVisible()
    await expect(page.getByLabel('使用者名稱', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '登入', exact: true })).toBeVisible()
  })

  test('language preference persists across page reload', async ({ page }) => {
    await page.goto('/login')
    await switchLocale(page, 'zh')
    await expect(page.getByText('登录以继续', { exact: true })).toBeVisible()

    // Reload page — cookie should persist
    await page.reload({ waitUntil: 'load' })

    await expect(page.getByText('登录以继续', { exact: true })).toBeVisible()
    await expect(page.getByLabel('用户名', { exact: true })).toBeVisible()

    const selectedValue = await page.getByLabel('Language').inputValue()
    expect(selectedValue).toBe('zh')
  })

  test('Spanish locale renders Spanish translations', async ({ page }) => {
    await page.goto('/login')
    await switchLocale(page, 'es')

    await expect(page.getByText('Inicia sesión para continuar', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Nombre de usuario', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible()
  })

  test('switching back to English restores English text', async ({ page }) => {
    await page.goto('/login')
    await switchLocale(page, 'zh')
    await expect(page.getByText('登录以继续', { exact: true })).toBeVisible()

    await switchLocale(page, 'en')
    await expect(page.getByText('Sign in to continue', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Username', { exact: true })).toBeVisible()
  })
})
