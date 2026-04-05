"use client";

/**
 * Stub components for Claw3D immersive screens that don't exist in Mission Control.
 * These are placeholder implementations used by RetroOffice3D.tsx.
 */

/* ── Types ── */

export type PhoneCallStep = string;

export type TextMessageStep = string;

export const TASK_BOARD_STATUSES = [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
] as const;

export type TaskBoardStatus = (typeof TASK_BOARD_STATUSES)[number];

export type TaskBoardSource =
  | "openclaw_event"
  | "claw3d_manual"
  | "playbook"
  | "fallback_inferred";

export type TaskBoardCard = {
  id: string;
  title: string;
  description: string;
  status: TaskBoardStatus;
  source: TaskBoardSource;
  sourceEventId: string | null;
  assignedAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  playbookJobId: string | null;
  runId: string | null;
  channel: string | null;
  externalThreadId: string | null;
  lastActivityAt: string | null;
  notes: string[];
  isArchived: boolean;
  isInferred: boolean;
};

/* ── Stub components ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SettingsPanel(_props: any) {
  return <div className="p-4 text-sm text-muted-foreground">Settings</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AtmImmersiveScreen(_props: any) {
  return <div className="p-4 text-sm text-muted-foreground">ATM</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function GithubImmersiveScreen(_props: any) {
  return <div className="p-4 text-sm text-muted-foreground">GitHub</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function KanbanImmersiveScreen(_props: any) {
  return <div className="p-4 text-sm text-muted-foreground">Kanban</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PhoneBoothImmersiveScreen(_props: any) {
  return <div className="p-4 text-sm text-muted-foreground">Phone Booth</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SmsBoothImmersiveScreen(_props: any) {
  return <div className="p-4 text-sm text-muted-foreground">SMS Booth</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function StandupImmersiveScreen(_props: any) {
  return <div className="p-4 text-sm text-muted-foreground">Standup</div>;
}
