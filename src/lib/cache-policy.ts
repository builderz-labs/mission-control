export function applyNoStoreDocumentHeaders(headers: Headers): Headers {
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  headers.set('Pragma', 'no-cache')
  headers.set('Expires', '0')
  return headers
}
