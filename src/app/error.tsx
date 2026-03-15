'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8">
      <h2 className="text-xl font-semibold mb-4">Something went wrong</h2>
      <p className="text-gray-400 mb-6 text-center max-w-md">
        An error occurred while loading this page.
        {error.digest && (
          <span className="block mt-2 text-sm text-gray-500">Error ID: {error.digest}</span>
        )}
      </p>
      <button
        onClick={reset}
        className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
