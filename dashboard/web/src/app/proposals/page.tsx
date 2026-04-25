"use client";

import { useEffect, useState } from "react";
import ProposalCard, { Proposal } from "@/components/ProposalCard";
import AdminTokenPrompt from "@/components/AdminTokenPrompt";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.ictwealthbuilding.com";

type Status = "pending" | "approved" | "rejected" | "all";

export default function ProposalsPage() {
  const [status, setStatus] = useState<Status>("pending");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setToken(localStorage.getItem("killzone_admin_token") ?? "");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/proposals?status=${status}&limit=100`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setProposals(data.proposals);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Proposal Tracker</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Discord proposals → Claude assessment → your decision
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      <AdminTokenPrompt token={token} onChange={setToken} />

      {loading && <p className="text-zinc-500 text-sm">Loading…</p>}
      {error && <p className="text-rose-400 text-sm">Error: {error}</p>}
      {!loading && !error && proposals.length === 0 && (
        <p className="text-zinc-500 text-sm py-12 text-center">
          No proposals matching <span className="text-zinc-300">{status}</span>.
        </p>
      )}

      <div className="space-y-4">
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            adminToken={token}
            onDecided={refresh}
            apiBase={API_BASE}
          />
        ))}
      </div>

      <p className="text-xs text-zinc-500 text-center pt-6 border-t border-zinc-800">
        Roadmap moved to its own page →{" "}
        <a href="/roadmap" className="text-emerald-400 hover:underline">Roadmap</a>
      </p>
    </div>
  );
}
