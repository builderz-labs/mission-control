'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface Reflection {
  id: number;
  week_of: string;
  generated_by: string;
  model: string | null;
  reflection: string;
  insights: string[];
  handoffs: { worked: string[]; broke: string[] };
  bottlenecks: string[];
  improvements_recommended: any[];
  improvements_implemented: number[];
  status: string;
  created_at: number;
}

interface Rule {
  id: number;
  rule_key: string;
  title: string;
  trigger_event: string;
  condition: string | null;
  then_action: string;
  target_agent: string | null;
  hypothesis: string | null;
  metric: string | null;
  metric_direction: string;
  baseline: number | null;
  applied_count: number;
  success_count: number;
  success_rate: number;
  avg_outcome_improvement: number | null;
  confidence: number;
  status: string;
  status_source: string;
  rationale: string | null;
}

interface Experiment {
  id: number;
  rule_id: number;
  rule_title: string;
  rule_status: string;
  week_of: string;
  metric: string | null;
  metric_direction: string;
  baseline: number | null;
  result: number | null;
  impact: number | null;
  verdict: string | null;
  status: string;
}

interface Dashboard {
  reflections: Reflection[];
  rules: Rule[];
  experiments: Experiment[];
  summary: {
    total_reflections: number;
    last_reflection_week: string | null;
    armed_rules: number;
    shadow_rules: number;
    retired_rules: number;
    experiments_running: number;
    experiments_improved: number;
  };
}

const statusColor = (s: string) =>
  s === 'armed' ? 'bg-green-100 text-green-800'
  : s === 'shadow' ? 'bg-slate-200 text-slate-700'
  : s === 'rejected' ? 'bg-red-100 text-red-800'
  : s === 'retired' ? 'bg-amber-100 text-amber-800'
  : 'bg-blue-100 text-blue-800';

const verdictColor = (v: string | null) =>
  v === 'improved' ? 'bg-green-100 text-green-800'
  : v === 'worsened' ? 'bg-red-100 text-red-800'
  : v === 'no_change' ? 'bg-slate-200 text-slate-700'
  : 'bg-slate-100 text-slate-500';

export function AtlasPanel() {
  const [tab, setTab] = useState<'reflections' | 'rules' | 'experiments'>('reflections');
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/atlas');
      const d = await res.json();
      if (res.ok) setData(d);
      else setMsg(d.error || 'Failed to load');
    } catch {
      setMsg('Failed to load Atlas data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const act = async (body: any, note: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/atlas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) { setMsg(note); await fetchData(); }
      else setMsg(d.error || 'Action failed');
    } catch {
      setMsg('Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-center py-8 text-slate-400">Loading Atlas data…</div>;
  if (!data) return <div className="text-center py-8 text-slate-400">{msg || 'No Atlas data'}</div>;

  const s = data.summary;

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-slate-400">
          {s.total_reflections} reflection(s){s.last_reflection_week ? ` · latest ${s.last_reflection_week}` : ''} ·{' '}
          <span className="font-semibold text-slate-200">{s.armed_rules}</span> armed /{' '}
          <span className="font-semibold text-slate-200">{s.shadow_rules}</span> shadow rules
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => act({ action: 'measure' }, 'Experiments re-scored')}
            disabled={busy}
            className="px-3 py-2 bg-slate-700 text-slate-100 rounded-lg text-sm font-medium hover:bg-slate-600 disabled:opacity-50"
          >
            {busy ? '…' : '📏 Measure'}
          </button>
          <button
            onClick={() => act({ action: 'reflect' }, 'Weekly reflection complete')}
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Reflecting…' : '🧭 Run reflection now'}
          </button>
        </div>
      </div>
      {msg && <div className="text-sm text-indigo-200 bg-indigo-900/40 border border-indigo-700 rounded p-2">{msg}</div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Armed rules" value={String(s.armed_rules)} sub="shaping next week" tone="good" />
        <Stat label="Shadow rules" value={String(s.shadow_rules)} sub="being measured" />
        <Stat label="Retired" value={String(s.retired_rules)} sub="didn't work" tone="warn" />
        <Stat label="Experiments live" value={String(s.experiments_running)} sub="in flight" />
        <Stat label="Improved" value={String(s.experiments_improved)} sub="metric moved" tone="good" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-700">
        {(['reflections', 'rules', 'experiments'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'reflections' ? 'Reflections' : t === 'rules' ? `Coordination rules (${data.rules.length})` : `Experiments (${data.experiments.length})`}
          </button>
        ))}
      </div>

      {tab === 'reflections' && <Reflections reflections={data.reflections} />}
      {tab === 'rules' && <Rules rules={data.rules} busy={busy} act={act} />}
      {tab === 'experiments' && <Experiments experiments={data.experiments} />}
    </div>
  );
}

function Reflections({ reflections }: { reflections: Reflection[] }) {
  if (reflections.length === 0) {
    return <div className="text-slate-400 text-sm py-6">No reflections yet — run one to reflect on this week.</div>;
  }
  return (
    <div className="space-y-4">
      {reflections.map((r) => (
        <div key={r.id} className="bg-slate-900/60 border border-slate-700 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">Week of {r.week_of}</h3>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.generated_by === 'ai' ? 'bg-violet-100 text-violet-800' : 'bg-slate-200 text-slate-700'}`}>
              {r.generated_by === 'ai' ? `🤖 ${r.model || 'AI'}` : '⚙️ heuristic'}
            </span>
          </div>
          <p className="text-sm text-slate-300 whitespace-pre-wrap mb-4">{r.reflection}</p>

          <div className="grid md:grid-cols-2 gap-4">
            {r.insights?.length > 0 && (
              <Section title="💡 Insights">
                {r.insights.map((x, i) => <li key={i}>{x}</li>)}
              </Section>
            )}
            {r.bottlenecks?.length > 0 && (
              <Section title="🚧 Bottlenecks">
                {r.bottlenecks.map((x, i) => <li key={i}>{x}</li>)}
              </Section>
            )}
            {r.handoffs?.worked?.length > 0 && (
              <Section title="✅ Hand-offs that worked">
                {r.handoffs.worked.map((x, i) => <li key={i}>{x}</li>)}
              </Section>
            )}
            {r.handoffs?.broke?.length > 0 && (
              <Section title="⚠️ Hand-offs that broke down">
                {r.handoffs.broke.map((x, i) => <li key={i}>{x}</li>)}
              </Section>
            )}
          </div>

          {r.improvements_recommended?.length > 0 && (
            <div className="mt-4 text-xs text-slate-400">
              Proposed {r.improvements_recommended.length} rule(s) · implemented {r.improvements_implemented?.length || 0}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Rules({ rules, busy, act }: { rules: Rule[]; busy: boolean; act: (b: any, n: string) => void }) {
  if (rules.length === 0) {
    return <div className="text-slate-400 text-sm py-6">No coordination rules yet — run a reflection to propose some.</div>;
  }
  return (
    <div className="space-y-3">
      {rules.map((r) => (
        <div key={r.id} className="bg-slate-900/60 border border-slate-700 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white">{r.title}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(r.status)}`}>{r.status}</span>
                {r.status_source === 'manual' && <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">manual</span>}
              </div>
              <div className="text-sm text-slate-300 mt-1">
                <span className="text-slate-500">when</span> <code className="text-indigo-300">{r.trigger_event}</code>
                {r.condition ? <> <span className="text-slate-500">if</span> {r.condition}</> : null}
                {' '}<span className="text-slate-500">→</span> {r.then_action}
                {r.target_agent ? <span className="text-slate-400"> ({r.target_agent})</span> : null}
              </div>
              {r.hypothesis && <div className="text-xs text-slate-400 mt-1">🔬 {r.hypothesis}</div>}
              <div className="text-xs text-slate-500 mt-2 flex gap-3 flex-wrap">
                {r.metric && <span>metric: <code className="text-slate-300">{r.metric}</code></span>}
                <span>baseline: {r.baseline ?? '—'}</span>
                <span>applied: {r.applied_count}w</span>
                <span>success: {Math.round((r.success_rate || 0) * 100)}%</span>
                <span>confidence: {Math.round((r.confidence || 0) * 100)}%</span>
                {r.avg_outcome_improvement != null && <span>avg Δ: {r.avg_outcome_improvement}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              {r.status !== 'armed' && (
                <button onClick={() => act({ action: 'arm', rule_id: r.id }, `Rule #${r.id} armed`)} disabled={busy}
                  className="px-3 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-600 disabled:opacity-50">Arm</button>
              )}
              {r.status !== 'shadow' && (
                <button onClick={() => act({ action: 'shadow', rule_id: r.id }, `Rule #${r.id} → shadow`)} disabled={busy}
                  className="px-3 py-1 text-xs bg-slate-700 text-slate-100 rounded hover:bg-slate-600 disabled:opacity-50">Shadow</button>
              )}
              {r.status !== 'rejected' && (
                <button onClick={() => act({ action: 'reject', rule_id: r.id }, `Rule #${r.id} rejected`)} disabled={busy}
                  className="px-3 py-1 text-xs bg-red-800 text-white rounded hover:bg-red-700 disabled:opacity-50">Reject</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Experiments({ experiments }: { experiments: Experiment[] }) {
  if (experiments.length === 0) {
    return <div className="text-slate-400 text-sm py-6">No experiments yet — rules open experiments when proposed.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 border-b border-slate-700">
            <th className="py-2 pr-3">Week</th>
            <th className="py-2 pr-3">Rule</th>
            <th className="py-2 pr-3">Metric</th>
            <th className="py-2 pr-3">Baseline</th>
            <th className="py-2 pr-3">Result</th>
            <th className="py-2 pr-3">Impact</th>
            <th className="py-2 pr-3">Verdict</th>
            <th className="py-2 pr-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {experiments.map((e) => (
            <tr key={e.id} className="border-b border-slate-800 text-slate-300">
              <td className="py-2 pr-3 whitespace-nowrap">{e.week_of}</td>
              <td className="py-2 pr-3">{e.rule_title}</td>
              <td className="py-2 pr-3"><code className="text-slate-400">{e.metric || '—'}</code></td>
              <td className="py-2 pr-3">{e.baseline ?? '—'}</td>
              <td className="py-2 pr-3">{e.result ?? '—'}</td>
              <td className={`py-2 pr-3 ${e.impact != null && e.impact > 0 ? 'text-green-400' : e.impact != null && e.impact < 0 ? 'text-red-400' : ''}`}>
                {e.impact ?? '—'}
              </td>
              <td className="py-2 pr-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${verdictColor(e.verdict)}`}>{e.verdict || '—'}</span></td>
              <td className="py-2 pr-3 text-slate-400">{e.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</h4>
      <ul className="list-disc list-inside text-sm text-slate-300 space-y-0.5">{children}</ul>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'cool' }) {
  const toneCls = tone === 'good' ? 'text-green-400' : tone === 'warn' ? 'text-amber-400' : tone === 'cool' ? 'text-sky-400' : 'text-white';
  return (
    <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">
      <div className={`text-2xl font-bold ${toneCls}`}>{value}</div>
      <div className="text-xs text-slate-300 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
