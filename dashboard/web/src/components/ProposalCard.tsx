"use client";

import { useState } from "react";

export type Proposal = {
  id: number;
  ts: string;
  discord_user: string;
  title: string;
  body: string;
  status: string;
  claude_recommendation: "APPROVE" | "REJECT" | "MODIFY" | null;
  claude_reasoning: string | null;
  claude_assessed_at: string | null;
  ross_decision: "APPROVED" | "REJECTED" | "REVISE" | null;
  ross_decided_at: string | null;
  ross_notes: string | null;
  implementation_status: string | null;
  shipped_in_version: string | null;
};

const recColor: Record<string, string> = {
  APPROVE: "text-emerald-400 border-emerald-700 bg-emerald-950/40",
  REJECT: "text-rose-400 border-rose-700 bg-rose-950/40",
  MODIFY: "text-amber-400 border-amber-700 bg-amber-950/40",
};

const decisionBadge: Record<string, string> = {
  APPROVED: "bg-emerald-900/60 text-emerald-300",
  REJECTED: "bg-rose-900/60 text-rose-300",
  REVISE: "bg-amber-900/60 text-amber-300",
};

function timeAgo(ts: string): string {
  const then = new Date(ts.replace(" ", "T") + (ts.includes("Z") || ts.includes("+") ? "" : "Z"));
  const sec = Math.floor((Date.now() - then.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function ProposalCard({
  proposal,
  isAdmin,
  apiBase,
  onDecided,
}: {
  proposal: Proposal;
  isAdmin: boolean;
  apiBase: string;
  onDecided: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decided = proposal.ross_decision !== null;

  async function decide(decision: "APPROVED" | "REJECTED" | "REVISE") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/proposals/${proposal.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ decision, notes: notes || null }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `HTTP ${res.status}`);
      }
      onDecided();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="border border-zinc-800 rounded-lg bg-zinc-900/40">
      <header className="flex items-start justify-between p-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <span>#{proposal.id}</span>
            <span>•</span>
            <span className="text-zinc-300">{proposal.discord_user}</span>
            <span>•</span>
            <span>{timeAgo(proposal.ts)}</span>
          </div>
          <h3 className="text-base font-semibold">{proposal.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {proposal.shipped_in_version && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
              shipped {proposal.shipped_in_version}
            </span>
          )}
          {proposal.implementation_status && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
              {proposal.implementation_status}
            </span>
          )}
          {decided && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${decisionBadge[proposal.ross_decision!] ?? ""}`}>
              {proposal.ross_decision}
            </span>
          )}
        </div>
      </header>

      <div className="p-4 space-y-4">
        <div className="text-sm text-zinc-300 whitespace-pre-wrap">{proposal.body}</div>

        {proposal.claude_recommendation && (
          <div className={`border rounded-md p-3 ${recColor[proposal.claude_recommendation]}`}>
            <div className="text-xs font-semibold mb-2 tracking-wide">
              CLAUDE&apos;S RECOMMENDATION: {proposal.claude_recommendation}
            </div>
            <div className="text-sm text-zinc-200 whitespace-pre-wrap">
              {proposal.claude_reasoning}
            </div>
          </div>
        )}

        {!proposal.claude_recommendation && (
          <div className="text-xs text-zinc-500 italic">
            Awaiting Claude&apos;s assessment.
          </div>
        )}

        {proposal.ross_notes && (
          <div className="text-sm text-zinc-400 border-l-2 border-zinc-700 pl-3">
            <span className="text-zinc-500 text-xs">Your notes:</span> {proposal.ross_notes}
          </div>
        )}

        {isAdmin && !decided && (
          <div className="space-y-2 pt-2 border-t border-zinc-800">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes (visible in DB, not sent to Discord)"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              rows={2}
            />
            <div className="flex items-center gap-2">
              <button
                disabled={submitting}
                onClick={() => decide("APPROVED")}
                className="px-3 py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
              >
                ✅ Approve
              </button>
              <button
                disabled={submitting}
                onClick={() => decide("REJECTED")}
                className="px-3 py-1.5 text-sm rounded-md bg-rose-700 hover:bg-rose-600 disabled:opacity-50"
              >
                ❌ Reject
              </button>
              <button
                disabled={submitting}
                onClick={() => decide("REVISE")}
                className="px-3 py-1.5 text-sm rounded-md bg-amber-700 hover:bg-amber-600 disabled:opacity-50"
              >
                📝 Send Back
              </button>
              {error && <span className="text-xs text-rose-400 ml-2">{error}</span>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
