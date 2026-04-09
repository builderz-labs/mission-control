// Thin barrel — all auth logic has been split into focused modules under src/lib/auth/.
// This file exists solely for backward compatibility with the many callers using '@/lib/auth'.
export * from './auth/index'
