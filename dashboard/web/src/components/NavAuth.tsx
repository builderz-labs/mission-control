"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";

export default function NavAuth() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  if (loading) return null;

  if (!user) {
    return (
      <a
        href="/login"
        className="px-3 py-1.5 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors"
      >
        Sign in
      </a>
    );
  }

  const displayName = user.discord_username ?? user.username;

  return (
    <div className="flex items-center gap-2">
      {user.discord_avatar && (
        <img src={user.discord_avatar} alt="" className="w-5 h-5 rounded-full" />
      )}
      <span className="text-xs text-zinc-500">{displayName}</span>
      <button
        onClick={async () => {
          await logout();
          router.push("/login");
        }}
        className="px-3 py-1.5 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
