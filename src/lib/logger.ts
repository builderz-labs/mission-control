import pino from 'pino'

function hasPinoPretty(): boolean {
  try {
    require.resolve('pino-pretty')
    return true
  } catch {
    return false
  }
}

const usePretty = process.env.NODE_ENV !== 'production' && hasPinoPretty()

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(usePretty && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
})
