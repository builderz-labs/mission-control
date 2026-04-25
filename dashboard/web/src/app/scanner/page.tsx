"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface Signal {
  ts: string;
  symbol: string;
  timeframe: string;
  direction: string;
  signal: string;
  confidence: number;
  price: number;
  conditions: string;
}

export default function ScannerPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/api/signals?limit=50`);
        const data = await res.json();
        setSignals(data.signals || []);
      } catch (e) {
        console.error("Failed to load signals:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-zinc-500 animate-pulse">Loading scanner data...</div></div>;
  }

  // Split into alerts and holds
  const alerts = signals.filter(s => s.signal === "ALERT");
  const holds = signals.filter(s => s.signal !== "ALERT");

  // Group latest by symbol/timeframe
  const latestByKey: Record<string, Signal> = {};
  for (const s of signals) {
    const key = `${s.symbol}-${s.timeframe}`;
    if (!latestByKey[key]) latestByKey[key] = s;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Scanner Status</h2>

      {/* Latest State Per Instrument */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.values(latestByKey).map((s) => (
          <Card key={`${s.symbol}-${s.timeframe}`} className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-mono">
                  {s.symbol} <span className="text-zinc-500">{s.timeframe}</span>
                </CardTitle>
                <Badge className={s.signal === "ALERT"
                  ? "bg-emerald-900 text-emerald-300"
                  : "bg-zinc-800 text-zinc-400"
                }>
                  {s.signal}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Price</span>
                  <span className="font-mono">{s.price?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Confidence</span>
                  <span className={`font-mono ${(s.confidence || 0) >= 80 ? "text-emerald-400" : "text-zinc-400"}`}>
                    {s.confidence}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Direction</span>
                  <span className={s.direction?.includes("LONG") ? "text-emerald-400" : s.direction?.includes("SHORT") ? "text-red-400" : "text-zinc-400"}>
                    {s.direction || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Last Scan</span>
                  <span className="text-xs text-zinc-500 font-mono">{s.ts?.slice(0, 16)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Alerts */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-400">
            Recent ALERT Signals ({alerts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length > 0 ? (
            <div className="space-y-2">
              {alerts.slice(0, 10).map((s, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                  <div className="flex items-center gap-3">
                    <Badge className="bg-emerald-900 text-emerald-300 text-xs">ALERT</Badge>
                    <span className="font-mono text-sm">{s.symbol}</span>
                    <span className="text-xs text-zinc-500">{s.timeframe}</span>
                    <span className={`text-xs ${s.direction?.includes("LONG") ? "text-emerald-400" : "text-red-400"}`}>
                      {s.direction}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm">{s.price?.toFixed(2)}</span>
                    <span className="text-xs text-zinc-500">{s.confidence}%</span>
                    <span className="text-xs text-zinc-600">{s.ts?.slice(0, 16)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-zinc-600">No ALERT signals in recent history</div>
          )}
        </CardContent>
      </Card>

      {/* Signal Log */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-400">
            Full Signal Log (last 50 scans)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-left">TF</th>
                  <th className="px-3 py-2 text-center">Signal</th>
                  <th className="px-3 py-2 text-center">Conf</th>
                  <th className="px-3 py-2 text-left">Direction</th>
                  <th className="px-3 py-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {signals.slice(0, 50).map((s, i) => (
                  <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                    <td className="px-3 py-1.5 font-mono text-zinc-500">{s.ts?.slice(11, 16)}</td>
                    <td className="px-3 py-1.5 font-mono">{s.symbol}</td>
                    <td className="px-3 py-1.5 font-mono text-zinc-400">{s.timeframe}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={s.signal === "ALERT" ? "text-emerald-400 font-semibold" : "text-zinc-600"}>
                        {s.signal}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center font-mono">{s.confidence}%</td>
                    <td className="px-3 py-1.5">
                      <span className={s.direction?.includes("LONG") ? "text-emerald-400" : s.direction?.includes("SHORT") ? "text-red-400" : "text-zinc-600"}>
                        {s.direction || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{s.price?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
