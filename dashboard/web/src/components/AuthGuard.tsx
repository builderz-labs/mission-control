"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

const PUBLIC_PATHS = ["/login"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user && !PUBLIC_PATHS.includes(pathname)) {
      router.replace("/login");
    }
  }, [user, loading, pathname, router]);

  // On a public path, always render
  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;

  // Loading — show blank screen (avoids flash of content)
  if (loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-zinc-500 text-sm">Loading...</div>
    </div>
  );

  // Not authenticated — render nothing (redirect is in flight)
  if (!user) return null;

  return <>{children}</>;
}
