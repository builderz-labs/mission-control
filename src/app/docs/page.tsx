'use client'

import { useEffect, useRef } from 'react'

/**
 * /docs - Swagger UI page for API documentation
 * Loads swagger-ui from CDN and points it at /api/docs for the OpenAPI spec.
 */
export default function DocsPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Load Swagger UI CSS
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css'
    document.head.appendChild(link)

    // Load Swagger UI JS
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js'
    script.onload = () => {
      if (containerRef.current && (window as any).SwaggerUIBundle) {
        ;(window as any).SwaggerUIBundle({
          url: '/api/docs',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            (window as any).SwaggerUIBundle.presets.apis,
            (window as any).SwaggerUIBundle.SwaggerUIStandalonePreset,
          ],
          layout: 'BaseLayout',
          defaultModelsExpandDepth: 1,
          docExpansion: 'list',
          filter: true,
          tryItOutEnabled: true,
        })
      }
    }
    document.body.appendChild(script)

    return () => {
      link.remove()
      script.remove()
    }
  }, [])

  return (
    <div className="min-h-screen bg-white">
      <div
        id="swagger-ui"
        ref={containerRef}
        style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}
      />
    </div>
  )
}
