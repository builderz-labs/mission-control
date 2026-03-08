// Re-export proxy as the Next.js Edge middleware entry point.
// Next.js requires the middleware function to be exported as `middleware` from src/middleware.ts.
// proxy.ts contains all session validation + Redis logic but was not being picked up
// because it exported the function as `proxy` with no middleware.ts re-export.
export { proxy as middleware, config } from './proxy'
