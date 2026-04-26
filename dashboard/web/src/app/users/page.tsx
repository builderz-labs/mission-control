"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.ictwealthbuilding.com";

interface User {
  user_id: string;
  display_name: string;
  active: boolean;
  connected: boolean;
  last_seen: string | null;
  hostname: string | null;
  agent_version: string | null;
  created_at: string | null;
  entitlement: {
    tier: string;
    max_contracts: number;
    live_enabled: boolean;
  };
}

function StatusBadge({ connected, active }: { connected: boolean; active: boolean }) {
  if (!active) return <span className="px-2 py-0.5 text-xs rounded-full bg-red-900/40 text-red-400 border border-red-800">REVOKED</span>;
  if (connected) return <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-800">ONLINE</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">OFFLINE</span>;
}

function fmtTime(ts: string | null) {
  if (!ts) return "never";
  try {
    return new Date(ts).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ts.slice(0, 16); }
}

export default function UsersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [users, setUsers]         = useState<User[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Invite modal state
  const [showInvite, setShowInvite]     = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteName, setInviteName]     = useState("");
  const [inviteToken, setInviteToken]   = useState<string | null>(null);
  const [inviting, setInviting]         = useState(false);
  const [inviteError, setInviteError]   = useState<string | null>(null);

  // Per-row state
  const [pendingRevoke, setPendingRevoke]   = useState<string | null>(null);
  const [revoking, setRevoking]             = useState<string | null>(null);
  const [restoring, setRestoring]           = useState<string | null>(null);
  const [regenerating, setRegenerating]     = useState<string | null>(null);
  const [regenToken, setRegenToken]         = useState<{ user_id: string; token: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API}/api/users`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!cancelled) setUsers(d.users); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, refreshKey]);

  const refresh = () => setRefreshKey(k => k + 1);

  // ── Invite ──────────────────────────────────────────────────────────────────

  const handleInvite = async () => {
    if (!inviteUserId.trim() || !inviteName.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const r = await fetch(`${API}/api/users`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: inviteUserId.trim(), display_name: inviteName.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail ?? `HTTP ${r.status}`);
      setInviteToken(d.pairing_token);
      refresh();
    } catch (e) {
      setInviteError(String(e));
    } finally {
      setInviting(false);
    }
  };

  const closeInvite = () => {
    setShowInvite(false);
    setInviteUserId("");
    setInviteName("");
    setInviteToken(null);
    setInviteError(null);
  };

  // ── Revoke ──────────────────────────────────────────────────────────────────

  const handleRevoke = async (userId: string) => {
    setRevoking(userId);
    try {
      await fetch(`${API}/api/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      refresh();
    } finally {
      setRevoking(null);
      setPendingRevoke(null);
    }
  };

  // ── Restore ────────────────────────────────────���─────────────────────────���───

  const handleRestore = async (userId: string) => {
    setRestoring(userId);
    try {
      await fetch(`${API}/api/users/${encodeURIComponent(userId)}/restore`, {
        method: "POST",
        credentials: "include",
      });
      refresh();
    } finally {
      setRestoring(null);
    }
  };

  // ── Regenerate token ─────────────────────────────────────────────────────────

  const handleRegenerate = async (userId: string) => {
    setRegenerating(userId);
    try {
      const r = await fetch(`${API}/api/users/${encodeURIComponent(userId)}/regenerate`, {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json();
      if (r.ok) setRegenToken({ user_id: userId, token: d.pairing_token });
    } finally {
      setRegenerating(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6 text-zinc-400 text-sm">
        Sign in as admin to manage users.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
          <p className="text-sm text-zinc-400 mt-1">Agent accounts, pairing tokens, entitlements</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="px-3 py-1.5 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors">
            Refresh
          </button>
          <button onClick={() => setShowInvite(true)} className="px-3 py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-600 transition-colors font-medium">
            + Invite User
          </button>
        </div>
      </header>

      {/* Table */}
      {loading && <p className="text-zinc-500 text-sm">Loading...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!loading && !error && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Tier</th>
                <th className="px-4 py-3 text-left">Last Seen</th>
                <th className="px-4 py-3 text-left">Host</th>
                <th className="px-4 py-3 text-left">Version</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                    No users yet. Click &quot;Invite User&quot; to create the first one.
                  </td>
                </tr>
              )}
              {users.map(u => (
                <tr key={u.user_id} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">{u.display_name}</div>
                    <div className="text-xs text-zinc-500">{u.user_id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge connected={u.connected} active={u.active} />
                    {u.entitlement.live_enabled && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-amber-900/40 text-amber-400 border border-amber-800">LIVE</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-300 capitalize">{u.entitlement.tier}</td>
                  <td className="px-4 py-3 text-zinc-400">{fmtTime(u.last_seen)}</td>
                  <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{u.hostname ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.agent_version ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleRegenerate(u.user_id)}
                        disabled={regenerating === u.user_id || !u.active}
                        className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
                      >
                        {regenerating === u.user_id ? "..." : "New Token"}
                      </button>
                      {!u.active ? (
                        <button onClick={() => handleRestore(u.user_id)} disabled={restoring === u.user_id}
                          className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-emerald-900/50 text-zinc-300 hover:text-emerald-300 disabled:opacity-40 transition-colors">
                          {restoring === u.user_id ? "..." : "Restore"}
                        </button>
                      ) : pendingRevoke === u.user_id ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleRevoke(u.user_id)} disabled={revoking === u.user_id}
                            className="px-2.5 py-1 text-xs rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 transition-colors">
                            {revoking === u.user_id ? "..." : "Confirm"}
                          </button>
                          <button onClick={() => setPendingRevoke(null)} className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setPendingRevoke(u.user_id)}
                          className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-red-900/50 text-zinc-300 hover:text-red-300 transition-colors">
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Regenerated token display */}
      {regenToken && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-amber-300">New pairing token for {regenToken.user_id}</p>
              <p className="text-xs text-amber-500 mt-1">Expires in 48 hours — single use. Send to the user now.</p>
            </div>
            <button onClick={() => setRegenToken(null)} className="text-amber-600 hover:text-amber-400 text-lg leading-none ml-4">×</button>
          </div>
          <TokenDisplay token={regenToken.token} />
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) closeInvite(); }}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            {inviteToken ? (
              <>
                <h3 className="text-lg font-semibold text-emerald-400 mb-1">User created</h3>
                <p className="text-sm text-zinc-400 mb-4">Send this pairing token to the user. It expires in 48 hours and is single-use.</p>
                <TokenDisplay token={inviteToken} />
                <button onClick={closeInvite} className="mt-4 w-full py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors">
                  Done
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-4">Invite User</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">User ID <span className="text-zinc-600">(short, no spaces — e.g. gameplan)</span></label>
                    <input
                      value={inviteUserId}
                      onChange={e => setInviteUserId(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                      placeholder="gameplan"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Display Name</label>
                    <input
                      value={inviteName}
                      onChange={e => setInviteName(e.target.value)}
                      placeholder="Gameplan"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  {inviteError && <p className="text-red-400 text-xs">{inviteError}</p>}
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={closeInvite} className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteUserId.trim() || !inviteName.trim()}
                    className="flex-1 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-sm font-medium transition-colors"
                  >
                    {inviting ? "Creating..." : "Create & Get Token"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenDisplay({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-3 flex items-center gap-2 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2">
      <code className="flex-1 text-xs text-emerald-300 font-mono break-all">{token}</code>
      <button onClick={copy} className="shrink-0 px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
