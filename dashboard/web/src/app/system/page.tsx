"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface SchedulerData {
  status: string;
  jobs_registered: number;
  jobs: Array<{ id: string; next_run: string | null; paused: boolean }>;
  recent_runs: { total: number; ok: number; error: number; no_reply: number };
  last_10_runs: Array<{
    ts: string; job_id: string; skillset: string; status: string;
    duration_ms: number; notify_level: string; output: string | null; error: string | null;
  }>;
}

interface HealthData {
  status: string;
  checks: Record<string, string>;
  timestamp: string;
}

export default function SystemPage() {
  const [scheduler, setScheduler] = useState<SchedulerData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [sched, hlth] = await Promise.all([
          fetch(`${API}/api/scheduler`).then(r => r.json()),
          fetch(`${API}/api/health`).then(r => r.json()),
        ]);
        setScheduler(sched);
        setHealth(hlth);
      } catch (e) {
        console.error("Failed to load system data:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-zinc-500 animate-pulse">Loading system status...</div></div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">System Status</h2>

      {/* Health Checks */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-zinc-400">Health Checks</CardTitle>
            <Badge className={health?.status === "ok" ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}>
              {health?.status || "unknown"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {health?.checks && Object.entries(health.checks).map(([name, status]) => (
              <div key={name} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50">
                <span className="text-sm capitalize">{name}</span>
                <span className={`text-xs font-mono ${String(status).includes("ok") ? "text-emerald-400" : "text-red-400"}`}>
                  {String(status).includes("ok") ? "✅" : "❌"}
                </span>
              </div>
            ))}
          </div>
          {health?.timestamp && (
            <p className="text-xs text-zinc-600 mt-3">Last checked: {health.timestamp.slice(0, 19)}</p>
          )}
        </CardContent>
      </Card>

      {/* Scheduler Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{scheduler?.jobs_registered || 0}</div>
            <p className="text-xs text-zinc-500 mt-1">Scheduled Jobs</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-emerald-400">{scheduler?.recent_runs?.ok || 0}</div>
            <p className="text-xs text-zinc-500 mt-1">Successful Runs</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-400">{scheduler?.recent_runs?.error || 0}</div>
            <p className="text-xs text-zinc-500 mt-1">Failed Runs</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-zinc-400">{scheduler?.recent_runs?.no_reply || 0}</div>
            <p className="text-xs text-zinc-500 mt-1">Silent (NO_REPLY)</p>
          </CardContent>
        </Card>
      </div>

      {/* Scheduled Jobs */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-400">Scheduled Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {scheduler?.jobs?.map((job) => (
              <div key={job.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${job.paused ? "bg-zinc-600" : "bg-emerald-500"}`} />
                  <span className="font-mono text-sm">{job.id}</span>
                </div>
                <div className="flex items-center gap-3">
                  {job.paused ? (
                    <Badge className="bg-zinc-800 text-zinc-500">Paused</Badge>
                  ) : (
                    <span className="text-xs text-zinc-500 font-mono">
                      Next: {job.next_run?.slice(0, 16) || "—"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Runs */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-400">Recent Job Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Job</th>
                  <th className="px-3 py-2 text-left">Skillset</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-right">Duration</th>
                  <th className="px-3 py-2 text-center">Notify</th>
                </tr>
              </thead>
              <tbody>
                {scheduler?.last_10_runs?.map((run, i) => (
                  <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                    <td className="px-3 py-1.5 font-mono text-zinc-500">{run.ts?.slice(11, 19)}</td>
                    <td className="px-3 py-1.5 font-mono">{run.job_id}</td>
                    <td className="px-3 py-1.5 text-zinc-400">{run.skillset}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Badge className={
                        run.status === "ok" ? "bg-emerald-900 text-emerald-300" :
                        run.status === "error" ? "bg-red-900 text-red-300" :
                        run.status === "no_reply" ? "bg-zinc-800 text-zinc-400" :
                        "bg-amber-900 text-amber-300"
                      }>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-zinc-400">
                      {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-center text-zinc-500">{run.notify_level}</td>
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
