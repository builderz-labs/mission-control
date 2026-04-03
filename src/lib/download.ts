/**
 * Browser file download utilities.
 * Centralises the create-anchor → click → revoke pattern to avoid
 * copy-pasted DOM manipulation across panels.
 */

/**
 * Triggers a browser download for an already-constructed Blob.
 * Handles ObjectURL lifecycle (create → click → revoke) safely.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.style.display = 'none'
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

/**
 * Triggers a browser download from a plain string.
 * Defaults to text/plain; pass 'text/csv' or 'text/markdown' as needed.
 */
export function downloadText(
  content: string,
  filename: string,
  mimeType = 'text/plain'
): void {
  downloadBlob(new Blob([content], { type: mimeType }), filename)
}
