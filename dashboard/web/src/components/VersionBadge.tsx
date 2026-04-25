"use client";

import { useEffect, useState } from "react";

type VersionInfo = {
  app: string;
  version: string;
  commit: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.ictwealthbuilding.com";

export default function VersionBadge() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/version`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  if (!info) return <span className="text-zinc-600 font-normal text-xs">—</span>;

  const title = info.commit ? `${info.app} v${info.version} (${info.commit})` : `${info.app} v${info.version}`;
  return (
    <span
      className="text-zinc-500 font-normal text-xs"
      title={title}
    >
      v{info.version}
    </span>
  );
}
