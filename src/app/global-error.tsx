'use client'

/**
 * Root error boundary. Catches client-side errors (e.g. chunk load failure, hydration).
 * Must define its own html/body — root layout is not mounted when this renders.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-zinc-400">
            {error.message || 'A client-side error occurred. Check the browser console for details.'}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-medium"
          >
            Try again
          </button>
          <p className="text-xs text-zinc-500 pt-4">
            If the problem continues, try a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) or clear cache.
          </p>
        </div>
      </body>
    </html>
  )
}
