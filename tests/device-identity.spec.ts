import { test, expect } from '@playwright/test'

/** Browser-level coverage for the WebCrypto/IndexedDB primitives used by device identity. */
test.describe('Device Identity — secure browser key storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(async () => {
      localStorage.removeItem('mc-device-id')
      localStorage.removeItem('mc-device-pubkey')
      localStorage.removeItem('mc-device-privkey')
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('mc-device-identity-e2e')
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      })
    })
  })

  test('persists a non-extractable Ed25519 private key in IndexedDB', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mc-device-identity-e2e', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('keys')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('keys', 'readwrite')
        const request = transaction.objectStore('keys').put(keyPair.privateKey, 'private-key')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      db.close()

      let exportRejected = false
      try {
        await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      } catch {
        exportRejected = true
      }
      return { extractable: keyPair.privateKey.extractable, exportRejected }
    })

    expect(result).toEqual({ extractable: false, exportRejected: true })
    expect(await page.evaluate(() => localStorage.getItem('mc-device-privkey'))).toBeNull()
  })

  test('stored CryptoKey remains usable after a page reload', async ({ page }) => {
    await page.evaluate(async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mc-device-identity-e2e', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('keys')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const request = db.transaction('keys', 'readwrite').objectStore('keys').put(keyPair.privateKey, 'private-key')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      db.close()
    })

    await page.reload()

    const signatureLength = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mc-device-identity-e2e', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const key = await new Promise<CryptoKey>((resolve, reject) => {
        const request = db.transaction('keys', 'readonly').objectStore('keys').get('private-key')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      db.close()
      const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode('challenge'))
      return signature.byteLength
    })

    expect(signatureLength).toBe(64)
  })
})
