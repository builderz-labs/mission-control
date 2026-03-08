'use client';

import React, { useState, useCallback } from 'react';
import { useSmartPoll } from '@/lib/use-smart-poll';

interface GpuStats {
  name: string;
  utilization: number;
  memUsed: number;
  memTotal: number;
  temp: number;
}

interface ProcessInfo {
  pid: string;
  name: string;
  cpu: number;
  mem: number;
  command: string;
}

interface OllamaModel {
  name: string;
  size: string;
  processor: string;
  context: string;
  until: string;
}

interface SystemData {
  cpu: number;
  cpuModel: string;
  cpuCores: number;
  loadAvg: { one: number; five: number; fifteen: number };
  memory: { total: number; used: number; available: number };
  disk: { total: string; used: string; available: string; usage: string };
  network: { inKBs: number; outKBs: number };
  gpu: GpuStats | null;
  uptime: number;
  topProcesses: ProcessInfo[];
  ollamaModels: OllamaModel[];
  activeSessionsByModel: Record<string, number>;
}

function formatUptime(ms: number): string {
  if (!ms) return '—';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Icons ──────────────────────────────────────────────────────────────────
const CpuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-blue-500">
    <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/> 
    <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/> 
    <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/> 
    <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/> 
    <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/> 
  </svg>
);

const RamIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-violet-500">
    <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h.01M14 14h.01M18 14h.01"/>
  </svg>
);

const GpuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-green-500">
    <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h4M14 10h4M6 14h4M14 14h4M8 6V4M16 6V4M8 20v-2M16 20v-2"/>
  </svg>
);

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-amber-500">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);

const DiskIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-yellow-500">
    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/> <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
);

const NetworkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-cyan-500">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/> <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
);

const OllamaIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-emerald-500">
    <path d="M12 2a7 7 0 0 1 7 7c0 4-3 6-7 9-4-3-7-5-7-9a7 7 0 0 1 7-7z"/>
    <circle cx="12" cy="9" r="2"/>
  </svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-slate-400">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);

// ── Bar ─────────────────────────────────────────────────────────────────
const Bar = ({ pct, color }: { pct: number; color: string }) => (
  <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
  </div>
);

// ── Main ────────────────────────────────────────────────────────────────
const SystemStatsPanel = () => {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/status?action=dashboard');
      if (!res.ok) return;
      const d = await res.json();
      setData({
        cpu: d.cpu ?? 0,
        cpuModel: d.cpuModel ?? '',
        cpuCores: d.cpuCores ?? 0,
        loadAvg: d.loadAvg ?? { one: 0, five: 0, fifteen: 0 },
        memory: d.memory ?? { total: 0, used: 0, available: 0 },
        disk: d.disk ?? { total: '—', used: '—', available: '—', usage: '0%' },
        network: d.network ?? { inKBs: 0, outKBs: 0 },
        gpu: d.gpu ?? null,
        uptime: d.uptime ?? 0,
        topProcesses: d.topProcesses ?? [],
        ollamaModels: d.ollamaModels ?? [],
        activeSessionsByModel: d.activeSessionsByModel ?? {},
      });
      setUpdatedAt(new Date());
    } catch (err) {
      console.error('Failed to fetch stats', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useSmartPoll(fetchStats, 30000, {
    pauseWhenDisconnected: false,
  });

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const ramTotalGB = data.memory.total / 1024;
  const ramUsedGB = data.memory.used / 1024;
  const ramFreeGB = (data.memory.available || data.memory.total - data.memory.used) / 1024;
  const ramPct = data.memory.total ? Math.round((data.memory.used / data.memory.total) * 100) : 0;
  const diskPct = data.disk.usage ? parseInt(data.disk.usage) : 0;
  const gpuTempColor = data.gpu ? (data.gpu.temp >= 85 ? 'bg-destructive' : data.gpu.temp >= 70 ? 'bg-amber-500' : 'bg-green-500') : 'bg-green-500';
  const gpuVramPct = data.gpu ? Math.round((data.gpu.memUsed / data.gpu.memTotal) * 100) : 0;

  return (
    <div className="p-6 pt-10 md:pt-6 max-w-7xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">System Stats</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time GPU, CPU, RAM, disk, and network monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && <span className="text-xs text-muted-foreground">Updated {formatTime(updatedAt)}</span>}
          <button onClick={fetchStats} className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card hover:bg-secondary transition-colors" >
            Refresh
          </button>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><CpuIcon /><span className="text-sm text-muted-foreground">CPU Usage</span></div>
          <div className="text-3xl font-bold text-foreground">{data.cpu.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground mt-1">{data.cpuCores} cores</div>
        </div>

        {/* RAM */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><RamIcon /><span className="text-sm text-muted-foreground">RAM Used</span></div>
          <div className="text-3xl font-bold text-foreground">{ramPct.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground mt-1">{ramUsedGB.toFixed(1)} GB / {ramTotalGB.toFixed(1)} GB</div>
        </div>

        {/* GPU */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><GpuIcon /><span className="text-sm text-muted-foreground">GPU Util</span></div>
          {data.gpu ? (
            <>
              <div className="text-3xl font-bold text-foreground">{data.gpu.utilization}%</div>
              <div className="text-xs text-muted-foreground mt-1">{data.gpu.memUsed} / {data.gpu.memTotal} MiB</div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">Unavailable</div>
          )}
        </div>

        {/* Uptime */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><ClockIcon /><span className="text-sm text-muted-foreground">Uptime</span></div>
          <div className="text-3xl font-bold text-foreground">{formatUptime(data.uptime)}</div>
          <div className="text-xs text-muted-foreground mt-1">{typeof window !== 'undefined' ? (navigator.platform || 'linux') : 'linux'}</div>
        </div>
      </div>

      {/* GPU detail */}
      {data.gpu && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><GpuIcon /><span className="text-lg font-semibold text-foreground">GPU</span></div>
            <span className="text-xs text-muted-foreground">GPU 0</span>
          </div>
          <div className="text-sm font-medium text-foreground mb-4">{data.gpu.name}</div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Utilization</span><span className="font-medium text-foreground">{data.gpu.utilization}%</span></div>
              <Bar pct={data.gpu.utilization} color="bg-green-500" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>VRAM</span><span className="font-medium text-foreground">{data.gpu.memUsed} / {data.gpu.memTotal} MiB</span></div>
              <Bar pct={gpuVramPct} color="bg-blue-500" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Temperature</span><span className={`font-medium ${data.gpu.temp >= 85 ? 'text-destructive' : data.gpu.temp >= 70 ? 'text-amber-500' : 'text-green-500'}`}>{data.gpu.temp}°C</span></div>
              <Bar pct={Math.min((data.gpu.temp / 100) * 100, 100)} color={gpuTempColor} />
            </div>
          </div>
        </div>
      )}

      {/* CPU + RAM row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CPU detail */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3"><CpuIcon /><span className="text-lg font-semibold text-foreground">CPU</span></div>
          {data.cpuModel && <div className="text-xs text-muted-foreground mb-1">Model</div>}
          {data.cpuModel && <div className="text-sm font-medium text-foreground mb-3">{data.cpuModel}</div>}
          <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Usage</span><span className="font-medium text-foreground">{data.cpu.toFixed(1)}%</span></div>
          <Bar pct={data.cpu} color="bg-blue-500" />
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-foreground">{data.cpuCores}</div>
              <div className="text-xs text-muted-foreground">Logical Cores</div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-foreground">{data.loadAvg.one.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">Load 1m</div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-foreground">{data.loadAvg.five.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">Load 5m</div>
            </div>
          </div>
        </div>

        {/* RAM detail */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3"><RamIcon /><span className="text-lg font-semibold text-foreground">RAM</span></div>
          <div className="h-[2.625rem]" /> {/* spacer to align boxes with CPU card */}
          <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Used</span><span className="font-medium text-foreground">{ramPct.toFixed(1)}%</span></div>
          <Bar pct={ramPct} color="bg-violet-500" />
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-foreground">{ramTotalGB.toFixed(1)} GB</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-foreground">{ramUsedGB.toFixed(1)} GB</div>
              <div className="text-xs text-muted-foreground">Used</div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-foreground">{ramFreeGB.toFixed(1)} GB</div>
              <div className="text-xs text-muted-foreground">Free</div>
            </div>
          </div>
        </div>
      </div>

      {/* Ollama Models */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <OllamaIcon />
            <span className="text-lg font-semibold text-foreground">Ollama Models</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {data.ollamaModels.length === 0 ? 'None loaded' : `${data.ollamaModels.length} running`}
          </span>
        </div>
        {data.ollamaModels.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No models currently loaded in memory</div>
        ) : (
          <div className="space-y-2">
            {data.ollamaModels.map((m, i) => {
              // count active sessions using this model (match on base name, case-insensitive)
              const baseName = m.name.split(':')[0].toLowerCase()
              const activeSessions = Object.entries(data.activeSessionsByModel)
                .filter(([k]) => k.includes(baseName))
                .reduce((acc, [, v]) => acc + v, 0)
              return (
                <div key={i} className="flex items-center justify-between bg-secondary/40 rounded-lg px-3 py-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-emerald-400">{m.name}</span>
                      {activeSessions > 0 && (
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${activeSessions >= 3 ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                          {activeSessions} agent{activeSessions !== 1 ? 's' : ''} active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {m.size}{m.processor ? ` · ${m.processor}` : ''}{m.context ? ` · ${m.context} ctx` : ''}
                    </div>
                  </div>
                  {m.until && <div className="text-xs text-muted-foreground">unloads {m.until}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Top Processes */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ListIcon />
            <span className="text-lg font-semibold text-foreground">Top Processes</span>
          </div>
          <span className="text-xs text-muted-foreground">by CPU usage</span>
        </div>
        {data.topProcesses.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No process data available</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left pb-2 font-medium w-16">PID</th>
                  <th className="text-left pb-2 font-medium">Process</th>
                  <th className="text-right pb-2 font-medium w-16">CPU %</th>
                  <th className="text-right pb-2 font-medium w-16">MEM %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.topProcesses.map((p, i) => (
                  <tr key={i} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-1.5 pr-2 text-muted-foreground font-mono">{p.pid}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`font-medium ${
                        p.name.includes('ollama') ? 'text-emerald-400' :
                        p.name.includes('next') ? 'text-blue-400' :
                        p.name.includes('openclaw') || p.name.includes('clawdbot') || p.name.includes('openclaw-gateway') ? 'text-violet-400' :
                        'text-foreground'
                      }`}>
                        {p.name}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      <span className={p.cpu > 80 ? 'text-destructive' : p.cpu > 40 ? 'text-amber-500' : 'text-foreground'}>
                        {p.cpu.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{p.mem.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Disk */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4"><DiskIcon /><span className="text-lg font-semibold text-foreground">Disk</span></div>
        <div className="flex justify-between items-center text-sm mb-2">
          <span className="text-muted-foreground font-mono">/</span>
          <span className="text-xs text-muted-foreground">{data.disk.used} / {data.disk.total} ({data.disk.usage})</span>
        </div>
        <Bar pct={diskPct} color="bg-yellow-500" />
      </div>

      {/* Network */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4"><NetworkIcon /><span className="text-lg font-semibold text-foreground">Network</span></div>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>↓ In</span><span className="font-medium text-foreground">{data.network.inKBs} KB/s</span></div>
            <Bar pct={Math.min(data.network.inKBs / 10, 100)} color="bg-blue-500" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>↑ Out</span><span className="font-medium text-foreground">{data.network.outKBs} KB/s</span></div>
            <Bar pct={Math.min(data.network.outKBs / 10, 100)} color="bg-orange-500" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemStatsPanel;