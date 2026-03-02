'use client'

import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'

export default function DocsPage() {
  return (
    <div className="h-screen">
      <ApiReferenceReact
        configuration={{
          url: '/api/docs',
          theme: 'kepler',
          darkMode: true,
          hideModels: false,
          hideDownloadButton: false,
          defaultHttpClient: {
            targetKey: 'shell',
            clientKey: 'curl',
          },
          metaData: {
            title: 'Mission Control API Docs',
          },
        }}
      />
    </div>
  )
}
