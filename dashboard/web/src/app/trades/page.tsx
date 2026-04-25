"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface Trade {
  id: number;
  ts_entry: string;
  ts_exit: string | null;
  symbol: string;
  timeframe: string;
  direction: string;
  status: string;
  entry_price: number;
  exit_price: number | null;
  stop_price: number;
  target_price: number;
  kz_active: number;
  notes: string;
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ status: "", symbol: "", timeframe: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const params = new URLSearchParams();
        if (filter.status) params.set("status", filter.status);
        if (filter.symbol) params.set("symbol", filter.symbol);
        if (filter.timeframe) params.set("timeframe", filter.timeframe);
        params.set("limit", "100");

        const res = await fetch(`${API}/api/trades?${params}`);
        const data = await res.json();
        setTrades(data.trades || []);
        setTotal(data.total || 0);
      } catch (e) {
        console.error("Failed to load trades:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [filter]);

  function pnl(t: Trade): string {
    if (!t.exit_price || !t.entry_price) return "—";
    const diff = t.direction === "LONG"
      ? t.exit_price - t.entry_price
      : t.entry_price - t.exit_price;
    return `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}`;
  }

  function statusColor(s: string) {
    switch (s) {
      case "WIN": return "bg-emerald-900 text-emerald-300";
      case "LOSS": return "bg-red-900 text-red-300";
      case "OPEN": return "bg-blue-900 text-blue-300";
      case "EXPIRED": return "bg-zinc-700 text-zinc-300";
      case "VOID": return "bg-zinc-800 text-zinc-500";
      default: return "";
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-zinc-500 animate-pulse">Loading trades...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Trade History</h2>
        <span className="text-sm text-zinc-500">{total} total trades</span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {["", "WIN", "LOSS", "OPEN", "EXPIRED"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter({ ...filter, status: s })}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter.status === s
                ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-600"
            }`}
          >
            {s || "All"}
          </button>
        ))}
        <div className="w-px bg-zinc-800" />
        {["", "ES=F", "NQ=F"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter({ ...filter, symbol: s })}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter.symbol === s
                ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-600"
            }`}
          >
            {s || "All Symbols"}
          </button>
        ))}
        <div className="w-px bg-zinc-800" />
        {["", "15m", "1h"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter({ ...filter, timeframe: s })}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter.timeframe === s
                ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-600"
            }`}
          >
            {s || "All TFs"}
          </button>
        ))}
      </div>

      {/* Trade List */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Symbol</th>
                  <th className="px-4 py-3 text-left font-medium">TF</th>
                  <th className="px-4 py-3 text-left font-medium">Direction</th>
                  <th className="px-4 py-3 text-right font-medium">Entry</th>
                  <th className="px-4 py-3 text-right font-medium">Exit</th>
                  <th className="px-4 py-3 text-right font-medium">Stop</th>
                  <th className="px-4 py-3 text-right font-medium">Target</th>
                  <th className="px-4 py-3 text-right font-medium">P&L</th>
                  <th className="px-4 py-3 text-center font-medium">KZ</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {t.ts_entry?.slice(0, 16)}
                    </td>
                    <td className="px-4 py-3 font-mono">{t.symbol}</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">{t.timeframe}</td>
                    <td className="px-4 py-3">
                      <span className={t.direction === "LONG" ? "text-emerald-400" : "text-red-400"}>
                        {t.direction === "LONG" ? "📗" : "📕"} {t.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{t.entry_price?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">
                      {t.exit_price?.toFixed(2) || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-red-400/60">{t.stop_price?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400/60">{t.target_price?.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${
                      pnl(t).startsWith("+") ? "text-emerald-400" : pnl(t).startsWith("-") ? "text-red-400" : "text-zinc-500"
                    }`}>
                      {pnl(t)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.kz_active ? "✅" : "❌"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={statusColor(t.status)}>{t.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trades.length === 0 && (
            <div className="py-12 text-center text-zinc-600">No trades match your filters</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
