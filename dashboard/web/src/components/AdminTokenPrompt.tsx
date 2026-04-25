"use client";

import { useState } from "react";

export default function AdminTokenPrompt({
  token,
  onChange,
}: {
  token: string;
  onChange: (t: string) => void;
}) {
  const [draft, setDraft] = useState(token);
  const [editing, setEditing] = useState(!token);

  function save() {
    localStorage.setItem("killzone_admin_token", draft);
    onChange(draft);
    setEditing(false);
  }

  function clear() {
    localStorage.removeItem("killzone_admin_token");
    setDraft("");
    onChange("");
    setEditing(true);
  }

  if (!editing) {
    return (
      <div className="text-xs text-zinc-500 flex items-center gap-2">
        <span>Admin token: ••••{token.slice(-6)}</span>
        <button onClick={() => setEditing(true)} className="underline hover:text-zinc-300">
          change
        </button>
        <button onClick={clear} className="underline hover:text-rose-400">
          clear
        </button>
      </div>
    );
  }

  return (
    <div className="border border-zinc-800 rounded-md p-3 bg-zinc-950">
      <label className="text-xs text-zinc-400 block mb-2">
        Admin token (stored in localStorage; required to approve/reject)
      </label>
      <div className="flex gap-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="paste KILLZONE_ADMIN_TOKEN value"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm font-mono"
        />
        <button
          onClick={save}
          disabled={!draft}
          className="px-3 py-1.5 text-sm rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
