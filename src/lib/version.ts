// Single source of truth for the application version.
// Reads from package.json at build time so every consumer
// (header, websocket handshake, API routes) stays in sync.
import pkg from '../../package.json'

export const APP_VERSION: string = pkg.version
