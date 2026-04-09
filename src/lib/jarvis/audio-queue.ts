'use client'

/**
 * Sequential audio playback queue for Jarvis TTS output.
 *
 * Decodes base64 audio chunks via the Web Audio API and plays them one after
 * another. Exposes an AnalyserNode so the orb visualiser can read frequency data.
 */

import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('Jarvis')

export interface AudioQueue {
  enqueue(base64: string): Promise<void>
  stop(): void
  getAnalyser(): AnalyserNode
  onFinished(cb: () => void): void
  destroy(): void
}

export function createAudioQueue(): AudioQueue {
  const audioCtx = new AudioContext()
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.8
  analyser.connect(audioCtx.destination)

  const queue: AudioBuffer[] = []
  let isPlaying = false
  let currentSource: AudioBufferSourceNode | null = null
  let finishedCallback: (() => void) | null = null

  function playNext(): void {
    if (queue.length === 0) {
      isPlaying = false
      currentSource = null
      finishedCallback?.()
      return
    }

    isPlaying = true
    const buffer = queue.shift()!
    const source = audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(analyser)
    currentSource = source

    source.onended = () => {
      // Only advance the queue if this source is still the current one
      if (currentSource === source) {
        playNext()
      }
    }

    source.start()
  }

  return {
    async enqueue(base64: string): Promise<void> {
      // Resume audio context per browser autoplay policy
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      try {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0))
        queue.push(audioBuffer)
        if (!isPlaying) playNext()
      } catch (err) {
        log.error('[JARVIS] audio decode error:', err)
        // Skip bad chunk and continue draining the queue
        if (!isPlaying && queue.length > 0) playNext()
      }
    },

    stop(): void {
      queue.length = 0
      if (currentSource) {
        try {
          currentSource.stop()
        } catch {
          // Already stopped — safe to ignore
        }
        currentSource = null
      }
      isPlaying = false
    },

    getAnalyser(): AnalyserNode {
      return analyser
    },

    onFinished(cb: () => void): void {
      finishedCallback = cb
    },

    destroy(): void {
      this.stop()
      void audioCtx.close()
    },
  }
}
