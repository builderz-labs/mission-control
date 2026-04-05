/**
 * Adapter layer: stubs for Claw3D external dependencies that don't exist
 * in Mission Control. These provide the minimal interfaces needed by the
 * retro-office scene code.
 */

import type { Agent } from "@/store";
import {
  createDefaultAvatarProfile,
  type OfficeAgent,
  type AgentAvatarProfile,
} from "@/features/retro-office/core/types";

/* ── Agent state (Claw3D's AgentState → Mission Control's Agent) ── */

export type AgentState = {
  agentId: string;
  name: string;
  status: "idle" | "running" | "error";
  role?: string | null;
  sessionKey: string;
  avatarProfile?: AgentAvatarProfile | null;
  model?: string | null;
  outputLines: string[];
  lastResult: string | null;
  streamText: string | null;
  latestPreview: string | null;
  lastActivityAt: number | null;
  draft: string;
};

export function agentToAgentState(agent: Agent): AgentState {
  return {
    agentId: String(agent.id),
    name: agent.name,
    status:
      agent.status === "busy"
        ? "running"
        : agent.status === "error"
          ? "error"
          : "idle",
    role: agent.role ?? null,
    sessionKey: `mc-${agent.id}`,
    avatarProfile: null,
    model: null,
    outputLines: [],
    lastResult: agent.last_activity ?? null,
    streamText: null,
    latestPreview: null,
    lastActivityAt: null,
    draft: "",
  };
}

export function agentToOfficeAgent(agent: Agent): OfficeAgent {
  const colors = [
    "#3b82f6",
    "#10b981",
    "#8b5cf6",
    "#f59e0b",
    "#ef4444",
    "#06b6d4",
    "#6366f1",
    "#14b8a6",
    "#f97316",
    "#ec4899",
  ];
  let hash = 0;
  for (let i = 0; i < agent.name.length; i++)
    hash = agent.name.charCodeAt(i) + ((hash << 5) - hash);
  const color = colors[Math.abs(hash) % colors.length];

  return {
    id: String(agent.id),
    name: agent.name,
    subtitle: agent.role ?? null,
    status:
      agent.status === "busy"
        ? "working"
        : agent.status === "error"
          ? "error"
          : "idle",
    color,
    item: agent.role ?? "engineer",
    avatarProfile: createDefaultAvatarProfile(agent.name),
  };
}

/* ── Cron job summary stub ── */
export type CronJobSummary = {
  id: string;
  label: string;
  agentId: string;
  schedule: string;
  enabled: boolean;
};

/* ── Office desk monitor stub ── */
export type OfficeDeskMonitorMode =
  | "coding"
  | "browser"
  | "waiting"
  | "idle"
  | "error";

export type OfficeDeskMonitorEntry = {
  kind: "user" | "assistant" | "thinking" | "tool";
  text: string;
  live?: boolean;
};

export type OfficeDeskMonitor = {
  agentId: string;
  agentName: string;
  mode: OfficeDeskMonitorMode;
  title: string;
  subtitle: string;
  browserUrl: string | null;
  updatedAt: number | null;
  live: boolean;
  entries: OfficeDeskMonitorEntry[];
  editor: {
    fileName: string;
    language: string;
    lines: string[];
    terminalLines: string[];
    cursorLine: number;
    cursorColumn: number;
  } | null;
};

/* ── Office animation state stub ── */
export type OfficeAnimationState = {
  awaitingApprovalByAgentId: Record<string, boolean>;
  cleaningCues: OfficeCleaningCue[];
  danceUntilByAgentId: Record<string, number>;
  deskHoldByAgentId: Record<string, boolean>;
  githubHoldByAgentId: Record<string, boolean>;
  gymHoldByAgentId: Record<string, boolean>;
  jukeboxHoldByAgentId: Record<string, boolean>;
  manualGymUntilByAgentId: Record<string, number>;
  pendingStandupRequest: null;
  phoneBoothHoldByAgentId: Record<string, boolean>;
  phoneCallByAgentId: Record<string, unknown>;
  qaHoldByAgentId: Record<string, boolean>;
  smsBoothHoldByAgentId: Record<string, boolean>;
  skillGymHoldByAgentId: Record<string, boolean>;
  streamingByAgentId: Record<string, boolean>;
  textMessageByAgentId: Record<string, unknown>;
  thinkingByAgentId: Record<string, boolean>;
  workingUntilByAgentId: Record<string, number>;
};

export function createEmptyAnimationState(): OfficeAnimationState {
  return {
    awaitingApprovalByAgentId: {},
    cleaningCues: [],
    danceUntilByAgentId: {},
    deskHoldByAgentId: {},
    githubHoldByAgentId: {},
    gymHoldByAgentId: {},
    jukeboxHoldByAgentId: {},
    manualGymUntilByAgentId: {},
    pendingStandupRequest: null,
    phoneBoothHoldByAgentId: {},
    phoneCallByAgentId: {},
    qaHoldByAgentId: {},
    smsBoothHoldByAgentId: {},
    skillGymHoldByAgentId: {},
    streamingByAgentId: {},
    textMessageByAgentId: {},
    thinkingByAgentId: {},
    workingUntilByAgentId: {},
  };
}

/* ── Office cleaning cue stub ── */
export type OfficeCleaningCue = {
  id: string;
  agentId: string;
  agentName: string;
  ts: number;
};

/* ── Office layout snapshot stub ── */
export type OfficeLayoutSnapshot = {
  gatewayUrl: string;
  timestamp: string;
  width: number;
  height: number;
  furniture: import("@/features/retro-office/core/types").FurnitureItem[];
};

/* ── Skill status entry stub ── */
export type SkillStatusEntry = {
  id: string;
  name: string;
  agentId: string;
  status: string;
};

/* ── Standup meeting stub ── */
export type StandupPhase = "scheduled" | "gathering" | "in_progress" | "complete";

export type StandupSummaryCard = {
  agentId: string;
  agentName: string;
  speech: string;
  currentTask: string;
  blockers: string[];
  recentCommits: { id: string; title: string; subtitle: string | null; url: string | null }[];
  activeTickets: { id: string; key: string; title: string; status: string; url: string | null }[];
  manualNotes: string[];
  sourceStates: { kind: string; ready: boolean; stale: boolean; updatedAt: string | null; error: string | null }[];
};

export type StandupMeeting = {
  id: string;
  trigger: "manual" | "scheduled";
  phase: StandupPhase;
  scheduledFor: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  currentSpeakerAgentId: string | null;
  speakerStartedAt: string | null;
  speakerDurationMs: number;
  participantOrder: string[];
  arrivedAgentIds: string[];
  cards: StandupSummaryCard[];
  participants: string[];
};

/* ── Gateway adapter type stub ── */
export type StudioGatewayAdapterType =
  | "openclaw"
  | "hermes"
  | "demo"
  | "custom";

/* ── Office usage analytics params stub ── */
export type OfficeUsageAnalyticsParams = {
  eventName: string;
  gatewayUrl?: string;
  properties?: Record<string, unknown>;
};

/* ── Mock phone call scenario stub ── */
export type MockPhoneCallPhase = "needs_message" | "ready_to_call";

export type MockPhoneCallScenario = {
  phase: MockPhoneCallPhase;
  callee: string;
  dialNumber: string;
  promptText: string | null;
  spokenText: string | null;
  recipientReply: string | null;
  statusLine: string;
  voiceAvailable: boolean;
};

export function buildMockPhoneCallScenario(params: {
  callee: string;
  message?: string | null;
  voiceAvailable: boolean;
}): MockPhoneCallScenario {
  return {
    phase: params.message ? "ready_to_call" : "needs_message",
    callee: params.callee,
    dialNumber: "555-0100",
    promptText: null,
    spokenText: params.message ?? null,
    recipientReply: null,
    statusLine: "Ready",
    voiceAvailable: params.voiceAvailable,
  };
}

/* ── Mock text message scenario stub ── */
export type MockTextMessagePhase = "needs_message" | "ready_to_send";

export type MockTextMessageScenario = {
  phase: MockTextMessagePhase;
  recipient: string;
  messageText: string | null;
  confirmationText: string | null;
  promptText: string | null;
  statusLine: string;
};

export function buildMockTextMessageScenario(params: {
  recipient: string;
  message?: string | null;
}): MockTextMessageScenario {
  return {
    phase: params.message ? "ready_to_send" : "needs_message",
    recipient: params.recipient,
    messageText: params.message ?? null,
    confirmationText: null,
    promptText: null,
    statusLine: "Ready",
  };
}

/* ── Speech image extraction stub ── */
export type SpeechImageResult = {
  cleanText: string;
  imageUrl: string | null;
};

export function extractSpeechImage(
  text: string | null | undefined,
  _agentId: string
): SpeechImageResult {
  return { cleanText: text ?? "", imageUrl: null };
}

/* ── Browser preview stub ── */
export function shouldPreferBrowserScreenshot(
  _value: string | null | undefined
): boolean {
  return false;
}

/* ── Office task types stub ── */
export type OfficeTaskCallbacks = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => void;
};

export { createDefaultAvatarProfile as createDefaultAgentAvatarProfile };
