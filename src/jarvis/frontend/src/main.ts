/**
 * JARVIS — Main entry point.
 *
 * Wires together the orb visualization, WebSocket communication,
 * speech recognition, and audio playback into a single experience.
 */

import { createOrb, type OrbState } from "./orb";
import { createVoiceInput, createAudioPlayer } from "./voice";
import { createSocket } from "./ws";
import { openSettings, checkFirstTimeSetup } from "./settings";
import "./style.css";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type State = "idle" | "listening" | "thinking" | "speaking";
let currentState: State = "idle";
let isMuted = false;

const statusEl    = document.getElementById("status-text")!;
const errorEl     = document.getElementById("error-text")!;
const statePillEl = document.getElementById("state-pill")!;
const stateLabelEl = document.getElementById("state-label")!;
const transcriptEl = document.getElementById("transcript")!;

// Matches STATE_COLORS in orb.ts — kept in sync manually
// Format: "R, G, B" so CSS can compose rgba(var(--state-color), opacity)
const STATE_CSS: Record<State, { rgb: string; glow: string }> = {
  idle:      { rgb: "76, 168, 232",  glow: "rgba(76, 168, 232, 0.12)"  },
  listening: { rgb: "0, 212, 255",   glow: "rgba(0, 212, 255, 0.15)"   },
  thinking:  { rgb: "129, 140, 248", glow: "rgba(129, 140, 248, 0.14)" },
  speaking:  { rgb: "52, 211, 153",  glow: "rgba(52, 211, 153, 0.14)"  },
};

let transcriptTimer: ReturnType<typeof setTimeout> | null = null;

function showError(msg: string): void {
  errorEl.textContent = msg;
  errorEl.style.opacity = "1";
  setTimeout(() => {
    errorEl.style.opacity = "0";
  }, 5000);
}

/** Show the user's spoken text briefly then fade it out. */
function showTranscript(text: string): void {
  transcriptEl.innerHTML = `<em>${text}</em>`;
  transcriptEl.classList.add("visible");
  if (transcriptTimer) clearTimeout(transcriptTimer);
  transcriptTimer = setTimeout(() => {
    transcriptEl.classList.remove("visible");
  }, 3500);
}

function updateStatus(state: State): void {
  const labels: Record<State, string> = {
    idle:      "",
    listening: "listening...",
    thinking:  "thinking...",
    speaking:  "",
  };
  statusEl.textContent = labels[state];

  // State pill
  statePillEl.dataset.state = state;
  stateLabelEl.textContent   = state;

  // CSS custom properties — drive body glow + pill color
  const { rgb, glow } = STATE_CSS[state];
  document.documentElement.style.setProperty("--state-color", rgb);
  document.documentElement.style.setProperty("--state-glow", glow);
}

// ---------------------------------------------------------------------------
// Init components
// ---------------------------------------------------------------------------

const canvas = document.getElementById("orb-canvas") as HTMLCanvasElement;
const orb = createOrb(canvas);

const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${wsProto}//${window.location.host}/ws/voice`;
const socket = createSocket(WS_URL);

const audioPlayer = createAudioPlayer();
orb.setAnalyser(audioPlayer.getAnalyser());

function transition(newState: State) {
  if (newState === currentState) return;
  currentState = newState;
  orb.setState(newState as OrbState);
  updateStatus(newState);

  switch (newState) {
    case "idle":
      if (!isMuted) voiceInput.resume();
      break;
    case "listening":
      if (!isMuted) voiceInput.resume();
      break;
    case "thinking":
      voiceInput.pause();
      break;
    case "speaking":
      voiceInput.pause();
      break;
  }
}

// ---------------------------------------------------------------------------
// Voice input
// ---------------------------------------------------------------------------

const voiceInput = createVoiceInput(
  (text: string) => {
    // Cancel any current JARVIS response before sending new input
    audioPlayer.stop();
    // Echo what the user said briefly
    showTranscript(text);
    // Send transcript to JARVIS
    socket.send({ type: "transcript", text, isFinal: true });
    transition("thinking");
  },
  (msg: string) => {
    showError(msg);
  }
);

// ---------------------------------------------------------------------------
// Audio playback finished
// ---------------------------------------------------------------------------

audioPlayer.onFinished(() => {
  transition("idle");
});

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------

socket.onMessage((msg) => {
  const type = msg.type as string;

  if (type === "audio") {
    const audioData = msg.data as string;
    if (process.env.NODE_ENV !== "production") {
      console.log("[audio] received", audioData ? `${audioData.length} chars` : "EMPTY", "state:", currentState);
    }
    if (audioData) {
      if (currentState !== "speaking") {
        transition("speaking");
      }
      audioPlayer.enqueue(audioData);
    } else {
      // TTS failed — no audio but still need to return to idle
      if (process.env.NODE_ENV !== "production") {
        console.warn("[audio] no data received, returning to idle");
      }
      transition("idle");
    }
    // Log text for debugging
    if (msg.text && process.env.NODE_ENV !== "production") console.log("[JARVIS]", msg.text);
  } else if (type === "status") {
    const state = msg.state as string;
    if (state === "thinking" && currentState !== "thinking") {
      transition("thinking");
    } else if (state === "working") {
      // Task spawned — show thinking with a different label
      transition("thinking");
      statusEl.textContent = "working...";
    } else if (state === "idle") {
      transition("idle");
    }
  } else if (type === "text") {
    // Text fallback when TTS fails
    if (process.env.NODE_ENV !== "production") console.log("[JARVIS]", msg.text);
  } else if (type === "task_spawned") {
    if (process.env.NODE_ENV !== "production") console.log("[task]", "spawned:", msg.task_id, msg.prompt);
  } else if (type === "task_complete") {
    if (process.env.NODE_ENV !== "production") console.log("[task]", "complete:", msg.task_id, msg.status, msg.summary);
  }
});

// ---------------------------------------------------------------------------
// Kick off
// ---------------------------------------------------------------------------

// Start listening after a brief delay for the orb to render
setTimeout(() => {
  voiceInput.start();
  transition("listening");
}, 1000);

// Resume AudioContext on ANY user interaction (browser autoplay policy)
function ensureAudioContext() {
  const ctx = audioPlayer.getAnalyser().context as AudioContext;
  if (ctx.state === "suspended") {
    ctx.resume().then(() => {
      if (process.env.NODE_ENV !== "production") console.log("[audio] context resumed");
    });
  }
}
document.addEventListener("click", ensureAudioContext);
document.addEventListener("touchstart", ensureAudioContext);
document.addEventListener("keydown", ensureAudioContext, { once: true });

// Try to resume audio context on load
ensureAudioContext();

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

const btnMute = document.getElementById("btn-mute")!;
const btnMenu = document.getElementById("btn-menu")!;
const menuDropdown = document.getElementById("menu-dropdown")!;
const btnRestart = document.getElementById("btn-restart")!;
const btnFixSelf = document.getElementById("btn-fix-self")!;

btnMute.addEventListener("click", (e) => {
  e.stopPropagation();
  isMuted = !isMuted;
  btnMute.classList.toggle("muted", isMuted);
  if (isMuted) {
    voiceInput.pause();
    transition("idle");
  } else {
    voiceInput.resume();
    transition("listening");
  }
});

btnMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  menuDropdown.style.display = menuDropdown.style.display === "none" ? "block" : "none";
});

document.addEventListener("click", () => {
  menuDropdown.style.display = "none";
});

btnRestart.addEventListener("click", async (e) => {
  e.stopPropagation();
  menuDropdown.style.display = "none";
  statusEl.textContent = "restarting...";
  try {
    await fetch("/api/restart", { method: "POST", signal: AbortSignal.timeout(8000) });
    // Wait a few seconds then reload
    setTimeout(() => window.location.reload(), 4000);
  } catch {
    statusEl.textContent = "restart failed";
  }
});

btnFixSelf.addEventListener("click", (e) => {
  e.stopPropagation();
  menuDropdown.style.display = "none";
  // Activate work mode on the WebSocket session (JARVIS becomes Claude Code's voice)
  socket.send({ type: "fix_self" });
  statusEl.textContent = "entering work mode...";
});

// Settings button
const btnSettings = document.getElementById("btn-settings")!;
btnSettings.addEventListener("click", (e) => {
  e.stopPropagation();
  menuDropdown.style.display = "none";
  openSettings();
});

// First-time setup detection — check after a short delay for server readiness
setTimeout(() => {
  checkFirstTimeSetup();
}, 2000);
