import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

// Password hashing using Node.js built-in scrypt
const SALT_LENGTH = 16
const KEY_LENGTH = 32
const SCRYPT_COST = 16384

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST }).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST })
  const storedBuf = Buffer.from(hash, 'hex')
  if (derived.length !== storedBuf.length) return false
  return timingSafeEqual(derived, storedBuf)
}

