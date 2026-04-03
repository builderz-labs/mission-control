/**
 * Tests for the useJarvis React hook.
 * WebSocket and AudioContext are fully mocked; no real network or audio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useJarvis } from '../jarvis/use-jarvis'

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  private static _instances: MockWebSocket[] = []
  static get instances() { return MockWebSocket._instances }
  static clearInstances() { MockWebSocket._instances = [] }

  constructor(url: string) {
    this.url = url
    MockWebSocket._instances.push(this)
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

  /** Simulate successful connection */
  triggerOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  /** Simulate connection close */
  triggerClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  /** Simulate error */
  triggerError() {
    this.onerror?.()
  }

  /** Simulate incoming message */
  triggerMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
}

// ---------------------------------------------------------------------------
// AudioContext mock
// ---------------------------------------------------------------------------

const mockAnalyserConnect = vi.fn()
const mockAnalyserGetFloat = vi.fn()
const mockSourceConnect = vi.fn()
const mockSourceStart = vi.fn()
const mockSourceStop = vi.fn()
const mockAudioContextClose = vi.fn(() => Promise.resolve())
const mockDecodeAudioData = vi.fn(() => Promise.resolve({}))
const mockAudioContextResume = vi.fn(() => Promise.resolve())
const mockCreateAnalyser = vi.fn(() => ({
  fftSize: 0,
  smoothingTimeConstant: 0,
  frequencyBinCount: 16,
  connect: mockAnalyserConnect,
  getFloatFrequencyData: mockAnalyserGetFloat,
  context: { state: 'running', resume: mockAudioContextResume },
}))
const mockCreateBufferSource = vi.fn(() => ({
  buffer: null,
  connect: mockSourceConnect,
  start: mockSourceStart,
  stop: mockSourceStop,
  onended: null as (() => void) | null,
}))

class MockAudioContext {
  state = 'running'
  destination = {}
  close = mockAudioContextClose
  resume = mockAudioContextResume
  decodeAudioData = mockDecodeAudioData
  createAnalyser = mockCreateAnalyser
  createBufferSource = mockCreateBufferSource
}

// ---------------------------------------------------------------------------
// SpeechRecognition mock
// ---------------------------------------------------------------------------

class MockSpeechRecognition {
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null

  private static _instances: MockSpeechRecognition[] = []
  static get instances() { return MockSpeechRecognition._instances }
  static clearInstances() { MockSpeechRecognition._instances = [] }

  constructor() {
    MockSpeechRecognition._instances.push(this)
  }

  start = vi.fn()
  stop = vi.fn(() => {
    // Simulate onend being called after stop
    setTimeout(() => this.onend?.(), 0)
  })
}

// Install globals before hook runs
vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('AudioContext', MockAudioContext)
vi.stubGlobal('SpeechRecognition', MockSpeechRecognition)

/**
 * Flush pending microtasks through N levels.
 */
const flushPromises = async (levels = 5) => {
  for (let i = 0; i < levels; i++) {
    await Promise.resolve()
  }
}

// Suppress auto-reconnect timers and speech recognition auto-start delays in tests
vi.useFakeTimers()

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = { wsUrl: 'ws://localhost:8765', enabled: true } as const

function getLastWs(): MockWebSocket | undefined {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

// ---------------------------------------------------------------------------
// Initial state tests
// ---------------------------------------------------------------------------

describe('useJarvis — initial state', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('starts disconnected when enabled is false', () => {
    const { result } = renderHook(() => useJarvis({ wsUrl: 'ws://localhost:8765', enabled: false }))
    expect(result.current.state).toBe('disconnected')
    expect(result.current.connected).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('starts disconnected before WebSocket opens when enabled is true', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    expect(result.current.connected).toBe(false)
    expect(result.current.state).toBe('disconnected')
  })

  it('has empty transcript and response initially', () => {
    const { result } = renderHook(() => useJarvis({ wsUrl: 'ws://localhost:8765', enabled: false }))
    expect(result.current.transcript).toBe('')
    expect(result.current.response).toBe('')
  })

  it('exposes connect, disconnect, sendTranscript, and toggleMute functions', () => {
    const { result } = renderHook(() => useJarvis({ wsUrl: 'ws://localhost:8765', enabled: false }))
    expect(typeof result.current.connect).toBe('function')
    expect(typeof result.current.disconnect).toBe('function')
    expect(typeof result.current.sendTranscript).toBe('function')
    expect(typeof result.current.toggleMute).toBe('function')
  })

  it('exposes analyserRef as a stable ref object, initially null', () => {
    const { result } = renderHook(() => useJarvis({ wsUrl: 'ws://localhost:8765', enabled: false }))
    expect(result.current.analyserRef).toBeDefined()
    expect(result.current.analyserRef.current).toBeNull()
  })

  it('starts with isMuted=false and isListening=false', () => {
    const { result } = renderHook(() => useJarvis({ wsUrl: 'ws://localhost:8765', enabled: false }))
    expect(result.current.isMuted).toBe(false)
    expect(result.current.isListening).toBe(false)
    expect(result.current.interimTranscript).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe('useJarvis — connection lifecycle', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('transitions to idle and connected on WebSocket open', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))

    act(() => {
      getLastWs()?.triggerOpen()
    })

    expect(result.current.connected).toBe(true)
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('creates WebSocket with the correct URL', () => {
    renderHook(() => useJarvis({ wsUrl: 'ws://myserver:9000', enabled: true }))
    expect(getLastWs()?.url).toBe('ws://myserver:9000/ws/voice')
  })

  it('does not create WebSocket when enabled is false', () => {
    renderHook(() => useJarvis({ wsUrl: 'ws://localhost:8765', enabled: false }))
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('transitions to disconnected when WebSocket closes', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))

    act(() => {
      getLastWs()?.triggerOpen()
    })
    expect(result.current.connected).toBe(true)

    act(() => {
      getLastWs()?.triggerClose()
    })

    expect(result.current.connected).toBe(false)
    expect(result.current.state).toBe('disconnected')
  })

  it('auto-reconnects after 3 seconds on close', () => {
    renderHook(() => useJarvis(DEFAULT_OPTIONS))
    const initialCount = MockWebSocket.instances.length

    act(() => {
      getLastWs()?.triggerOpen()
      getLastWs()?.triggerClose()
    })

    act(() => {
      vi.advanceTimersByTime(3001)
    })

    expect(MockWebSocket.instances.length).toBeGreaterThan(initialCount)
  })

  it('does NOT reconnect when enabled is toggled to false before close fires', () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useJarvis({ wsUrl: 'ws://localhost:8765', enabled }),
      { initialProps: { enabled: true } }
    )
    const countAfterConnect = MockWebSocket.instances.length

    act(() => { getLastWs()?.triggerOpen() })

    rerender({ enabled: false })

    act(() => { getLastWs()?.triggerClose() })

    act(() => { vi.advanceTimersByTime(5000) })

    expect(MockWebSocket.instances.length).toBe(countAfterConnect)
  })

  it('cleans up WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    const ws = getLastWs()!
    unmount()

    expect(ws.close).toHaveBeenCalled()
  })

  it('auto-starts speech recognition after WebSocket opens', () => {
    renderHook(() => useJarvis(DEFAULT_OPTIONS))

    act(() => { getLastWs()?.triggerOpen() })
    // Speech recognition starts after a 500ms delay
    act(() => { vi.advanceTimersByTime(600) })

    expect(MockSpeechRecognition.instances.length).toBeGreaterThan(0)
    const lastRec = MockSpeechRecognition.instances[MockSpeechRecognition.instances.length - 1]
    expect(lastRec.start).toHaveBeenCalled()
    expect(lastRec.continuous).toBe(true)
    expect(lastRec.interimResults).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('useJarvis — error state', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('transitions to error state on WebSocket error', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))

    act(() => {
      getLastWs()?.triggerError()
    })

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('WebSocket connection failed')
  })

  it('sets error when WebSocket constructor throws', () => {
    vi.stubGlobal('WebSocket', class {
      constructor() { throw new Error('bad url') }
    })

    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('Failed to create WebSocket connection')

    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  it('onerror clears the reconnect timer so onclose does not double-schedule', () => {
    renderHook(() => useJarvis(DEFAULT_OPTIONS))

    act(() => { getLastWs()?.triggerOpen() })
    const countBeforeError = MockWebSocket.instances.length

    act(() => {
      getLastWs()?.triggerError()
      getLastWs()?.triggerClose()
    })

    act(() => { vi.advanceTimersByTime(3001) })

    expect(MockWebSocket.instances.length).toBe(countBeforeError + 1)
  })
})

// ---------------------------------------------------------------------------
// Incoming message handling
// ---------------------------------------------------------------------------

describe('useJarvis — incoming messages', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('updates response state on text message', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    act(() => {
      getLastWs()?.triggerMessage({ type: 'text', content: 'Hello, Tony!' })
    })

    expect(result.current.response).toBe('Hello, Tony!')
  })

  it('transitions to thinking state on status message', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    act(() => {
      getLastWs()?.triggerMessage({ type: 'status', status: 'thinking' })
    })

    expect(result.current.state).toBe('thinking')
  })

  it('transitions to speaking state on status message', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    act(() => {
      getLastWs()?.triggerMessage({ type: 'status', status: 'speaking' })
    })

    expect(result.current.state).toBe('speaking')
  })

  it('transitions to listening state on status message', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    act(() => {
      getLastWs()?.triggerMessage({ type: 'status', status: 'listening' })
    })

    expect(result.current.state).toBe('listening')
  })

  it('does not crash on malformed JSON message', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    act(() => {
      const ws = getLastWs()!
      ws.onmessage?.({ data: 'not-json-{{{' })
    })

    expect(result.current.state).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// sendTranscript
// ---------------------------------------------------------------------------

describe('useJarvis — sendTranscript', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('sends transcript over WebSocket when connected', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })
    const ws = getLastWs()!
    ws.readyState = MockWebSocket.OPEN

    act(() => {
      result.current.sendTranscript('What is the status?')
    })

    expect(ws.send).toHaveBeenCalledOnce()
    const payload = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(payload.type).toBe('transcript')
    expect(payload.text).toBe('What is the status?')
    expect(payload.isFinal).toBe(true)
  })

  it('sets local transcript state', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })
    const ws = getLastWs()!
    ws.readyState = MockWebSocket.OPEN

    act(() => {
      result.current.sendTranscript('Hello JARVIS')
    })

    expect(result.current.transcript).toBe('Hello JARVIS')
  })

  it('transitions to thinking state on sendTranscript', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })
    const ws = getLastWs()!
    ws.readyState = MockWebSocket.OPEN

    act(() => {
      result.current.sendTranscript('test')
    })

    expect(result.current.state).toBe('thinking')
  })

  it('does not send when WebSocket is not open', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    const ws = getLastWs()!

    act(() => {
      result.current.sendTranscript('test')
    })

    expect(ws.send).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Audio path — playAudioChunk (via `audio` message type)
// ---------------------------------------------------------------------------

describe('useJarvis — audio message handling', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
    if (!Blob.prototype.arrayBuffer) {
      Object.defineProperty(Blob.prototype, 'arrayBuffer', {
        value(): Promise<ArrayBuffer> {
          return Promise.resolve(new ArrayBuffer(0))
        },
        configurable: true,
        writable: true,
      })
    }
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('creates AudioContext and decodes base64 audio on audio message', async () => {
    renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    await act(async () => {
      getLastWs()?.triggerMessage({ type: 'audio', data: btoa('fake-audio-bytes') })
      await flushPromises()
    })

    expect(mockDecodeAudioData).toHaveBeenCalled()
  })

  it('transitions to speaking state on audio message', async () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    await act(async () => {
      getLastWs()?.triggerMessage({ type: 'audio', data: btoa('fake-audio') })
      await flushPromises()
    })

    expect(result.current.state).toBe('speaking')
  })

  it('handles Blob binary frame via decodeBlobAudio', async () => {
    renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    const blob = new Blob(['fake-audio'], { type: 'audio/wav' })

    await act(async () => {
      const ws = getLastWs()!
      ws.onmessage?.({ data: blob })
      await flushPromises()
    })

    expect(mockDecodeAudioData).toHaveBeenCalled()
  })

  it('closes AudioContext on disconnect to prevent resource leak', async () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    await act(async () => {
      getLastWs()?.triggerMessage({ type: 'audio', data: btoa('chunk') })
      await flushPromises()
    })

    act(() => { result.current.disconnect() })

    expect(mockAudioContextClose).toHaveBeenCalled()
  })

  it('populates analyserRef.current after first audio chunk', async () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    expect(result.current.analyserRef.current).toBeNull()

    await act(async () => {
      getLastWs()?.triggerMessage({ type: 'audio', data: btoa('chunk') })
      await flushPromises()
    })

    expect(result.current.analyserRef.current).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Mute toggle
// ---------------------------------------------------------------------------

describe('useJarvis — toggleMute', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('toggles isMuted state', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })

    expect(result.current.isMuted).toBe(false)

    act(() => { result.current.toggleMute() })
    expect(result.current.isMuted).toBe(true)

    act(() => { result.current.toggleMute() })
    expect(result.current.isMuted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe('useJarvis — disconnect', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances()
    MockSpeechRecognition.clearInstances()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('closes WebSocket and sets state to disconnected', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => { getLastWs()?.triggerOpen() })
    const ws = getLastWs()!

    act(() => {
      result.current.disconnect()
    })

    expect(ws.close).toHaveBeenCalled()
    expect(result.current.connected).toBe(false)
    expect(result.current.state).toBe('disconnected')
  })

  it('cancels pending reconnect timer on disconnect', () => {
    const { result } = renderHook(() => useJarvis(DEFAULT_OPTIONS))
    act(() => {
      getLastWs()?.triggerOpen()
      getLastWs()?.triggerClose()
    })

    act(() => {
      result.current.disconnect()
    })

    const countBefore = MockWebSocket.instances.length
    act(() => { vi.advanceTimersByTime(5000) })
    expect(MockWebSocket.instances.length).toBe(countBefore)
  })
})
