"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface Overview {
  summary: { total_trades: number; wins: number; losses: number; open_count: number; win_rate: number };
  by_symbol: Array<{ symbol: string; wins: number; losses: number; win_rate: number }>;
  by_timeframe: Array<{ timeframe: string; wins: number; losses: number; win_rate: number }>;
  by_direction: Array<{ direction: string; wins: number; losses: number; win_rate: number }>;
  today_trades: number;
}

interface EquityCurvePoint {
  date: string; pnl_pts: number; pnl_dollars: number; cumulative: number; symbol: string; status: string;
}
interface EquityData {
  curve: EquityCurvePoint[];
  curve_es: EquityCurvePoint[];
  curve_nq: EquityCurvePoint[];
  total_pnl: number;
  total_pnl_es_pts: number;
  total_pnl_nq_pts: number;
}

interface Position {
  symbol: string; timeframe: string; direction: string;
  entry_price: number; stop_price: number; target_price: number; t1?: number; t2?: number; t3?: number; ts_entry: string;
}

function KpiCard({ title, value, subtitle, color }: {
  title: string; value: string | number; subtitle?: string; color?: string;
}) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-zinc-400">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color || "text-zinc-100"}`}>{value}</div>
        {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [equity, setEquity] = useState<EquityData | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [equityTab, setEquityTab] = useState<"dollars" | "es" | "nq">("dollars");

  useEffect(() => {
    async function load() {
      try {
        const [ov, eq, pos] = await Promise.all([
          fetch(`${API}/api/overview`).then(r => r.json()),
          fetch(`${API}/api/equity`).then(r => r.json()),
          fetch(`${API}/api/positions`).then(r => r.json()),
        ]);
        setOverview(ov);
        setEquity(eq);
        setPositions(pos.positions || []);
      } catch (e) {
        setError(`Failed to load: ${e}`);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500 animate-pulse">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  const s = overview?.summary;
  const wrColor = (s?.win_rate || 0) >= 65 ? "text-emerald-400" :
                  (s?.win_rate || 0) >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="Win Rate"
          value={`${s?.win_rate || 0}%`}
          subtitle={`${s?.wins || 0}W / ${s?.losses || 0}L`}
          color={wrColor}
        />
        <KpiCard
          title="Total Trades"
          value={s?.total_trades || 0}
          subtitle={`${overview?.today_trades || 0} today`}
        />
        <KpiCard
          title="Open Positions"
          value={s?.open_count || 0}
          subtitle={positions.length > 0 ? positions.map(p => p.symbol).join(", ") : "None"}
        />
        <KpiCard
          title="Total P&L"
          value={equity?.total_pnl !== undefined ? `${equity.total_pnl >= 0 ? "+" : ""}$${equity.total_pnl.toFixed(0)}` : "N/A"}
          color={equity && equity.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}
          subtitle={equity ? `ES ${equity.total_pnl_es_pts >= 0 ? "+" : ""}${equity.total_pnl_es_pts.toFixed(1)} pts  |  NQ ${equity.total_pnl_nq_pts >= 0 ? "+" : ""}${equity.total_pnl_nq_pts.toFixed(1)} pts` : "Paper (dollars)"}
        />
      </div>

      {/* Equity Curve */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-zinc-400">Equity Curve</CardTitle>
            <div className="flex gap-1">
              {(["dollars", "es", "nq"] as const).map((tab) => (
                <button key={tab} onClick={() => setEquityTab(tab)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    equityTab === tab
                      ? "bg-zinc-700 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}>
                  {tab === "dollars" ? "$ Combined" : tab === "es" ? "ES pts" : "NQ pts"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const tabData = equityTab === "dollars" ? equity?.curve
                          : equityTab === "es"      ? equity?.curve_es
                                                    : equity?.curve_nq;
            const label = equityTab === "dollars" ? "cumulative ($)"
                        : equityTab === "es"      ? "cumulative (ES pts)"
                                                  : "cumulative (NQ pts)";
            const color = equityTab === "nq" ? "#818cf8" : "#10b981";
            const gradId = `grad-${equityTab}`;

            return tabData && tabData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={tabData}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 11 }}
                    tickFormatter={(v) => v?.slice(5, 10) || ""} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }}
                    tickFormatter={(v) => equityTab === "dollars" ? `$${v}` : `${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                    labelStyle={{ color: "#a1a1aa" }}
                    itemStyle={{ color: "#e4e4e7" }}
                    formatter={(v) => {
                      const n = typeof v === "number" ? v : Number(v ?? 0);
                      return [equityTab === "dollars" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} pts`, label];
                    }}
                  />
                  <Area type="monotone" dataKey="cumulative" stroke={color}
                    fill={`url(#${gradId})`} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-zinc-600">
                No closed {equityTab === "es" ? "ES" : equityTab === "nq" ? "NQ" : ""} trades yet
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* By Symbol */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">By Symbol</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview?.by_symbol.map((s) => (
              <div key={s.symbol} className="flex items-center justify-between">
                <span className="font-mono text-sm">{s.symbol}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{s.wins}W/{s.losses}L</span>
                  <Badge variant={s.win_rate >= 65 ? "default" : "secondary"}
                    className={s.win_rate >= 65 ? "bg-emerald-900 text-emerald-300" : ""}>
                    {s.win_rate}%
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* By Timeframe */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">By Timeframe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview?.by_timeframe.map((t) => (
              <div key={t.timeframe} className="flex items-center justify-between">
                <span className="font-mono text-sm">{t.timeframe}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{t.wins}W/{t.losses}L</span>
                  <Badge variant={t.win_rate >= 65 ? "default" : "secondary"}
                    className={t.win_rate >= 65 ? "bg-emerald-900 text-emerald-300" : ""}>
                    {t.win_rate}%
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* By Direction */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">By Direction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview?.by_direction.map((d) => (
              <div key={d.direction} className="flex items-center justify-between">
                <span className="font-mono text-sm">{d.direction === "LONG" ? "📗" : "📕"} {d.direction}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{d.wins}W/{d.losses}L</span>
                  <Badge variant={d.win_rate >= 65 ? "default" : "secondary"}
                    className={d.win_rate >= 65 ? "bg-emerald-900 text-emerald-300" : ""}>
                    {d.win_rate}%
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Open Positions */}
      {positions.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">Open Positions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {positions.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                  <div className="flex items-center gap-3">
                    <Badge className={p.direction === "LONG" ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}>
                      {p.direction}
                    </Badge>
                    <span className="font-mono text-sm">{p.symbol}</span>
                    <span className="text-xs text-zinc-500">{p.timeframe}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span>Entry: {p.entry_price.toFixed(2)}</span>
                    <span className="text-red-400">Stop: {p.stop_price.toFixed(2)}</span>
                    <span className="text-emerald-400">T1: {(p.t1 || p.target_price).toFixed(2)}</span>
                    {p.t2 && <span className="text-emerald-300/70">T2: {p.t2.toFixed(2)}</span>}
                    {p.t3 && <span className="text-emerald-200/50">T3: {p.t3.toFixed(2)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
