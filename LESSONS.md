# LESSONS.md

Project lessons, architectural decisions, and backlog items for Ultron Mission Control.

---

## 2026-03-31 — JARVIS Voice Feature Audit & Production Hardening

### Lessons Learned

#### React Rules of Hooks — Early Return Before Hooks
**Problem**: A conditional `return null` before hook calls causes ESLint `react-hooks/rules-of-hooks` violations.
**Solution**: Extract all hook logic into an inner component (`JarvisOrbInner`). The outer exported component (`JarvisOrb`) is a pure guard with no hooks.
**Pattern**:
```tsx
function JarvisOrbInner() { /* all hooks here */ }
export function JarvisOrb() {
  if (!isFeatureEnabled()) return null
  return <JarvisOrbInner />
}
```

#### requestAnimationFrame Leak
**Problem**: Storing RAF return value in a variable that is never used to cancel causes an animation loop to continue after component destroy, consuming GPU resources and potentially crashing on stale refs.
**Fix**: `let rafId = 0; rafId = requestAnimationFrame(animate);` and `cancelAnimationFrame(rafId)` in destroy.

#### O(N²) Nested Loop — GPU Thermal Risk
**Problem**: A connection-line rendering loop iterated all N particles × N particles (N=1200) on every frame at 60fps.
**Fix**: Skip the expensive loop on 2 out of 3 frames — `if (frameCount++ % 3 !== 0) return` — cutting cost ~3× while keeping the visual smooth.

#### WebSocket Protocol Auto-Detection (ws:// vs wss://)
**Problem**: Hardcoded `ws://` causes mixed-content browser errors when the dashboard is served over HTTPS.
**Fix**: `const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'`
**Override**: `NEXT_PUBLIC_JARVIS_WS_URL` takes full priority for custom deployments.

#### Unused State Driving Re-renders
**Problem**: `audioData` state was updated on every audio chunk (high-frequency), but no consumer read it — pure wasted re-renders.
**Fix**: Remove the state entirely. The AnalyserNode is read directly by the Three.js engine via `analyserRef`.

#### Fire-and-Forget Async in Tests (Vitest + jsdom)
**Problem**: `void decodeBlobAudio(blob)` starts a multi-level async chain. `await act(async () => {...})` only flushes one microtask level. State updates from deep in the chain appear to be outside `act`.
**Fix**: Loop `await Promise.resolve()` N times (N ≥ depth of async chain) inside `act` to drain the entire microtask queue.

#### jsdom 26 — Missing `Blob.prototype.arrayBuffer`
**Problem**: jsdom 26.1.0 (vitest default) does not implement `Blob.prototype.arrayBuffer()`. Tests using real `Blob` objects fail with `TypeError: blob.arrayBuffer is not a function`.
**Fix**: Polyfill in `beforeEach` of the affected describe block:
```typescript
if (!Blob.prototype.arrayBuffer) {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    value(): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(0)) },
    configurable: true, writable: true,
  })
}
```
Use `vi.spyOn(Blob.prototype, 'arrayBuffer').mockRejectedValueOnce(...)` for error-path testing.

#### `instanceof Blob` Guard — Reject Plain Object Mocks
**Problem**: Using `{ arrayBuffer: () => Promise.reject(...) } as unknown as Blob` for negative testing looks correct but fails `instanceof Blob`, so the guard in the handler never routes to `decodeBlobAudio`.
**Rule**: Always use real `Blob` instances + `vi.spyOn` for error-path testing of blob handlers.

#### Security — Auth on Internal API Endpoints
**Problem**: Health/diagnostics endpoints (`/api/jarvis/health`) exposed infrastructure details without auth. An unauthenticated attacker could probe the JARVIS backend address and connection status.
**Fix**: Wrap with `apiGuard({ role: 'viewer', rateLimit: 'read' })` — even read-only diagnostic endpoints require authentication in production.

#### Function Size Discipline
**Problem**: `createThreeOrb` was 305 lines — impossible to review or test in isolation.
**Fix**: Extract to standalone module with named helper functions, each < 50 lines. Each function has one job: `updateStateTargets`, `lerpAll`, `readAudio`, `updateConnections`, etc.

#### Transcript Injection Prevention
**Problem**: Long transcripts could be used to inject oversized payloads into the JARVIS backend.
**Fix**: `if (transcript.length > 2000) return 413` before processing.

#### Audio Reactivity Wiring — analyserRef Must Be Exposed
**Problem**: `useJarvis` held `analyserRef` as a private internal ref. The Three.js orb's `setAnalyser()` method was never called, so `bass`/`mid` audio data in every particle/connection calculation was always zero. The orb couldn't pulse with JARVIS's speech audio despite the full audio-reactive rendering pipeline being in place.
**Fix**: Added `analyserRef: { readonly current: AnalyserNode | null }` to `JarvisHandle`, returned it from the hook, and wired it into the orb from `jarvis-orb.tsx` via the state sync `useEffect` and on orb creation.
**Rule**: Any ref that drives visual effects must be part of the public interface. Internal refs that rendering engines depend on are not an implementation detail — they are API surface.

#### startListening Closure Over Full Hook Result
**Problem**: `startListening = useCallback(..., [jarvis])` closed over the entire `useJarvis` result object. Since the hook returns a new object reference on every state change (`state`, `response`, `transcript` all change frequently), `startListening` was recreated on every JARVIS state update — and `toggleListening` with it.
**Fix**: Destructure `const { sendTranscript } = jarvis` before the callback and depend on `[sendTranscript]` instead. `sendTranscript` is wrapped in `useCallback([])` inside the hook so it is stable for the component's lifetime.
**Rule**: Always close over the minimum stable slice of a hook's return value, never the full object.

---

## 2026-03-31 — JARVIS UX Hardening Pass

### Lessons Learned

#### ThreeOrbState Must Cover All JarvisState Values
**Problem**: `ThreeOrbState` only had 4 values (`idle`, `listening`, `thinking`, `speaking`). `disconnected` and `error` both silently fell through to `idle`, so the orb looked identical whether JARVIS was healthy or completely broken.
**Fix**: Added `'disconnected'` (dim grey, slow, no connections) and `'error'` (dim red, no connections) to `ThreeOrbState`. State sync in `jarvis-orb.tsx` maps all 6 `JarvisState` values explicitly.
**Rule**: Visual state machines and data state machines must be kept in sync. Every unhandled case is a silent UI lie.

#### Semantically Distinct Colors Over Same-Hue Shades
**Problem**: All 4 orb states used blue variants (`0x4ca8e8`, `0x6ec4ff`, `0x5ab8f0`) — indistinguishable for color-blind users and visually noisy.
**Fix**: Each state now has a semantically meaningful hue: green (listening), amber (thinking), sky-blue (speaking), zinc-grey (disconnected), red (error), blue (idle). Colors are chosen from the Tailwind 400/500 palette for consistency with the UI.
**Rule**: State colors should carry semantic meaning, not just aesthetic variation.

#### BLOCKER — Mobile Nav Bar Occludes Fixed-Position Components
**Problem**: JARVIS orb was fixed at `bottom-6 right-6 z-[45]`. The mobile bottom nav bar sits at `bottom-0 z-50 h-14` (56px). On phones, the nav physically covered the orb — users could not tap it.
**Fix**: `bottom-20 sm:bottom-6` — on mobile, 80px from bottom clears the nav + 24px breathing room; on `sm:` and above, restores 24px from bottom.
**Rule**: Any `fixed` component must account for other `fixed` bars. Use responsive `bottom-*` to handle nav bars by breakpoint.

#### SpeechRecognition Failures Must Surface to the User
**Problem**: `window.SpeechRecognition ?? window.webkitSpeechRecognition` — when `undefined` (Firefox, Samsung Browser, etc.), `startListening` returned silently. Users tapped the mic button and nothing happened, with zero feedback.
**Fix**: Added `localError` state. If `SpeechRecognition` is not defined, set a user-visible message and return early. If `recognition.onerror` fires, map the error code to a plain-English message (`not-allowed` → "Microphone access denied — allow it in your browser settings").
**Rule**: Browser API unavailability is user-visible failure. Always surface it with actionable guidance.

#### sendTranscript Silent Drop When WS Closed
**Problem**: If `wsRef.current?.readyState !== WebSocket.OPEN`, `sendTranscript` would update transcript state but silently discard the message. Users spoke and JARVIS never responded — no feedback whatsoever.
**Fix**: Added `else { setError('Not connected — message was not sent. Reconnecting...') }` to the `sendTranscript` callback so `jarvis.error` is populated and can be surfaced to the UI.

#### WCAG AA Contrast Failure on State Label
**Problem**: `text-zinc-500` on `bg-zinc-950/95` achieves ~3.1:1 contrast ratio — below the WCAG AA requirement of 4.5:1 for small text.
**Fix**: `text-zinc-300` achieves ~7.8:1 — passes AAA.

#### WCAG Touch Target — Close Button
**Problem**: Close button was `w-6 h-6` (24×24px), below the WCAG 2.5.5 minimum of 44×44px.
**Fix**: `w-8 h-8` (32×32px) with `-m-1 p-1` hit area expansion gives an effective 40×40px tap zone. Close to minimum — flagged in backlog for a future `w-11 h-11` upgrade.

#### Mini Button aria-label Should Reflect Live State
**Problem**: `aria-label="Open JARVIS voice assistant"` was static — screen reader users had no indication of current state.
**Fix**: Dynamic label: `"Open JARVIS voice assistant — ${jarvisState}"` so VoiceOver/TalkBack announces the state on focus.

---

## Backlog

- [ ] E2E test: keyboard trap (Escape closes expanded panel, focus returns to mini button)
- [ ] E2E test: JARVIS voice full flow (connect → speak → response renders)
- [ ] Consider upgrading vitest jsdom environment to one with Blob.arrayBuffer native support
- [ ] Evaluate moving Blob audio path to a WebWorker to prevent main-thread jank during large audio decode
- [ ] Add CSP nonce to JARVIS WebSocket connection origin validation
## Session: 2026-04-02 — Deep Panel Audit + Brand Management

### Completed
- 15 bugs fixed across 10 panel/API files
- Brand management UI (BrandSection) with plug-and-play logos
- Login product logos (Claude/Codex/Hermes/OpenClaw) stay fixed
- All 30 panel pages return HTTP 200
- All 31 API endpoints return 200
- 1013 tests passing, TypeScript clean
- Pushed to uitron remote (feat/jarvis-voice branch)
- Password reset to Jet5575

### Open Items for Next Session
- JARVIS: wake word detection ('Jarvis' triggers listening)
- JARVIS: reduce latency (streaming TTS, pre-warmed WS)
- JARVIS: full platform control (wire all 30+ API endpoints)
- JARVIS: ecosystem data context (inject live system state)

