"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.ictwealthbuilding.com";

type GithubIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  milestone?: string;
};

type GithubProgress = {
  total: number;
  closed: number;
  pct: number;
  issues: GithubIssue[];
};

type Phase = {
  id: string;
  name: string;
  status: "planned" | "in_progress" | "done" | "blocked" | "deferred";
  system?: string;
  eta?: string;
  milestone?: string;
  shipped_in_version?: string;
  commits?: string[];
  pr?: string;
  deliverables?: string[];
  notes?: string;
  issues?: number[];
  github_progress?: GithubProgress;
};

type Track = {
  id: string;
  name: string;
  description: string;
  design_doc?: string;
  phases: Phase[];
};

type RoadmapResponse = {
  summary: {
    track_count: number;
    phase_count: number;
    by_status: Record<string, number>;
  };
  tracks: Track[];
  source: string;
};

const statusStyle: Record<Phase["status"], string> = {
  done: "bg-emerald-900/40 border-emerald-700 text-emerald-300",
  in_progress: "bg-amber-900/40 border-amber-700 text-amber-300",
  planned: "bg-zinc-900/60 border-zinc-700 text-zinc-300",
  blocked: "bg-rose-900/40 border-rose-700 text-rose-300",
  deferred: "bg-zinc-900/30 border-zinc-800 text-zinc-500",
};

const statusLabel: Record<Phase["status"], string> = {
  done: "DONE",
  in_progress: "IN PROGRESS",
  planned: "PLANNED",
  blocked: "BLOCKED",
  deferred: "DEFERRED",
};

const REPO_BASE = "https://github.com/spaceghostroce/roce-os";

function commitUrl(sha: string): string {
  return `${REPO_BASE}/commit/${sha}`;
}

function docUrl(path: string): string {
  return `${REPO_BASE}/blob/main/${path}`;
}

function PhaseCard({ phase }: { phase: Phase }) {
  return (
    <div className={`border rounded-md p-3 ${statusStyle[phase.status]}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-semibold">{phase.name}</h4>
          {phase.system === "roceos" && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-indigo-700/60 bg-indigo-900/30 text-indigo-300 whitespace-nowrap">
              RoceOS
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-current/40 whitespace-nowrap shrink-0">
          {statusLabel[phase.status]}
        </span>
      </div>

      {phase.eta && (
        <div className="text-xs text-zinc-400 mb-2">
          <span className="text-zinc-500">ETA:</span> {phase.eta}
        </div>
      )}
      {phase.shipped_in_version && (
        <div className="text-xs text-zinc-400 mb-2">
          <span className="text-zinc-500">Shipped in:</span>{" "}
          <span className="font-mono">v{phase.shipped_in_version}</span>
        </div>
      )}

      {phase.deliverables && phase.deliverables.length > 0 && (
        <ul className="text-xs text-zinc-300 space-y-1 mb-2 ml-4 list-disc">
          {phase.deliverables.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}

      {phase.milestone && (
        <div className="text-xs text-zinc-500 mb-2">
          <span className="text-zinc-600">Milestone:</span>{" "}
          <span className="font-mono">{phase.milestone}</span>
        </div>
      )}

      {phase.github_progress && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-500">Issues</span>
            <span className="font-mono text-zinc-400">
              {phase.github_progress.closed}/{phase.github_progress.total} closed
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1 mb-2">
            <div
              className="bg-emerald-600 h-1 rounded-full transition-all"
              style={{ width: `${phase.github_progress.pct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {phase.github_progress.issues.map((issue) => (
              <a
                key={issue.number}
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                title={issue.title}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                  issue.state === "closed"
                    ? "border-emerald-700/60 bg-emerald-900/20 text-emerald-400 line-through opacity-60"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                #{issue.number}
              </a>
            ))}
          </div>
        </div>
      )}

      {phase.notes && (
        <div className="text-xs text-zinc-400 italic mb-2 border-l-2 border-current/30 pl-2">
          {phase.notes}
        </div>
      )}

      {(phase.commits?.length || phase.pr) && (
        <div className="flex flex-wrap items-center gap-2 text-xs mt-2 pt-2 border-t border-current/20">
          {phase.commits?.map((sha) => (
            <a
              key={sha}
              href={commitUrl(sha)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-zinc-400 hover:text-zinc-100 underline"
            >
              {sha}
            </a>
          ))}
          {phase.pr && (
            <a
              href={phase.pr}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-zinc-100 underline"
            >
              PR
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function TrackSection({ track }: { track: Track }) {
  const done = track.phases.filter((p) => p.status === "done").length;
  const total = track.phases.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section id={track.id} className="border border-zinc-800 rounded-lg bg-zinc-900/30 overflow-hidden">
      <header className="p-4 border-b border-zinc-800">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="text-lg font-semibold">{track.name}</h3>
            <p className="text-sm text-zinc-400 mt-1">{track.description}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-zinc-100">{pct}%</div>
            <div className="text-xs text-zinc-500">{done} / {total} done</div>
          </div>
        </div>
        <div className="w-full bg-zinc-800 rounded-full h-1.5 mt-2">
          <div className="bg-emerald-600 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        {track.design_doc && (
          <a
            href={docUrl(track.design_doc)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-emerald-400 hover:underline mt-2 inline-block"
          >
            📄 {track.design_doc}
          </a>
        )}
      </header>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {track.phases.map((p) => (
          <PhaseCard key={p.id} phase={p} />
        ))}
      </div>
    </section>
  );
}

export default function RoadmapPage() {
  const [data, setData] = useState<RoadmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/roadmap`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="text-rose-400 text-sm">Error: {error}</p>;
  if (!data) return <p className="text-zinc-500 text-sm">Loading roadmap…</p>;

  const { summary, tracks } = data;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Roadmap</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Capability tracks across Killzone, the trading system, and infra. Source:{" "}
            <a
              href={docUrl("docs/roadmap.yaml")}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 hover:underline font-mono"
            >
              docs/roadmap.yaml
            </a>
          </p>
        </div>
        <div className="text-right text-xs text-zinc-400 space-x-3 font-mono">
          <span><span className="text-emerald-400">{summary.by_status.done ?? 0}</span> done</span>
          <span><span className="text-amber-400">{summary.by_status.in_progress ?? 0}</span> active</span>
          <span><span className="text-zinc-300">{summary.by_status.planned ?? 0}</span> planned</span>
          <span><span className="text-zinc-500">{summary.by_status.deferred ?? 0}</span> deferred</span>
          {summary.by_status.blocked ? (
            <span><span className="text-rose-400">{summary.by_status.blocked}</span> blocked</span>
          ) : null}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 text-xs">
        {tracks.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800"
          >
            {t.name}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        {tracks.map((t) => (
          <TrackSection key={t.id} track={t} />
        ))}
      </div>

      <footer className="text-xs text-zinc-500 text-center pt-6 border-t border-zinc-800">
        To update: edit{" "}
        <a href={docUrl("docs/roadmap.yaml")} target="_blank" rel="noreferrer" className="font-mono text-emerald-400 hover:underline">
          docs/roadmap.yaml
        </a>{" "}
        and commit. Cached 60s.
      </footer>
    </div>
  );
}
