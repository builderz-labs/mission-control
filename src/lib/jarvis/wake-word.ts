'use client'

/**
 * Wake-word detection for Jarvis voice activation.
 *
 * Centralised here so the trigger word can be changed or replaced with a
 * proper ML-based detector without touching the main hook.
 */

const WAKE_WORD = /\bjarvis\b/i

/**
 * Returns true if the transcript contains the Jarvis wake word.
 */
export function containsWakeWord(text: string): boolean {
  return WAKE_WORD.test(text)
}
