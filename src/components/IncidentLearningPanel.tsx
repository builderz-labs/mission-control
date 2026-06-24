'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface LearnedRule {
  id: number;
  scope_type: string;
  property_id: string | null;
  category: string;
  pattern_key: string;
  predicted_severity: string;
  predicted_impact_score: number;
  recurs_within_days: number | null;
  recurrence_rate: number;
  hits: number;
  consistency: number;
  confidence: number;
  status: string;
  status_source: string;
  rationale: string;
}

interface AccuracyRow {
  scope: string;
  n: number;
  accurate: number;
  under_predicted: number;
  over_predicted: number;
  accuracy_rate: number;
  mean_abs_severity_delta: number | null;
}

interface InterventionRow {
  intervention_type: string;
  attempts: number;
  successes: number;
  recurrences: number;
  avg_resolution_hours: number | null;
  avg_cost: number | null;
  success_rate: number;
}

interface Dashboard {
  rules: LearnedRule[];
  accuracy: AccuracyRow[];
  interventions: InterventionRow[];
  summary: {
    resolved_with_outcome: number;
    accurate: number;
    under_predicted: number;
    over_predicted: number;
    accuracy_rate: number;
    armed_rules: number;
    shadow_rules: number;
    recurring_patterns: number;
  };
}

const sevColor = (s: string) =>
  s === 'critical' ? 'bg-red-100 text-red-800'
  : s === 'high' ? 'bg-orange-100 text-orange-800'
  : s === 'medium' ? 'bg-yellow-100 text-yellow-800'
  : 'bg-blue-100 text-blue-800';

export function IncidentLearningPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/incidents/learning');
      const d = await res.json();
      if (res.ok) setData(d);
      else setMsg(d.error || 'Failed to load');
    } catch (e) {
      setMsg('Failed to load learning data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const act = async (body: any, note: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/incidents/learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) {
        setMsg(note);
        await fetchData();
      } else {
        setMsg(d.error || 'Action failed');
      }
    } catch {
      setMsg('Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">Loading learning data...</div>;
  if (!data) return <div className="text-center py-8 text-gray-500">{msg || 'No learning data'}</div>;

  const s = data.summary;
  const overall = data.accuracy.find((a) => a.scope === 'overall');

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-gray-600">
          {s.resolved_with_outcome} resolved incidents analysed ·{' '}
          <span className="font-semibold">{s.armed_rules}</span> armed /{' '}
          <span className="font-semibold">{s.shadow_rules}</span> shadow rules
        </div>
        <button
          onClick={() => act({ action: 'run' }, 'Learning pass complete')}
          disabled={busy}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Running…' : '↻ Run learning pass'}
        </button>
      </div>
      {msg && <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded p-2">{msg}</div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Prediction accuracy" value={`${Math.round((s.accuracy_rate || 0) * 100)}%`} sub={overall ? `n=${overall.n}` : ''} />
        <Stat label="Under-predicted" value={String(s.under_predicted)} sub="worse than triaged" tone="warn" />
        <Stat label="Over-predicted" value={String(s.over_predicted)} sub="over-escalated" tone="cool" />
        <Stat label="Recurring patterns" value={String(s.recurring_patterns)} sub="rules with a cycle" />
      </div>

      {/* Learned rules */}
      <section>
        <h3 className="font-semibold text-white mb-3">Learned scoring rules</h3>
        <div className="space-y-3">
          {data.rules.length === 0 && (
            <div className="text-gray-400 text-sm">No rules learned yet — resolve more incidents, then run a pass.</div>
          )}
          {data.rules.map((r) => (
            <div key={r.id} className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="font-mono text-sm text-gray-800">{r.pattern_key}</div>
                  <div className="text-xs text-gray-500">
                    {r.scope_type === 'property_category' ? 'Property-specific' : 'Category-wide'} · {r.hits} hits · {Math.round(r.consistency * 100)}% consistent · conf {r.confidence.toFixed(2)}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${sevColor(r.predicted_severity)}`}>
                    {r.predicted_severity} · {r.predicted_impact_score}/10
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    r.status === 'armed' ? 'bg-green-100 text-green-800'
                    : r.status === 'rejected' ? 'bg-gray-200 text-gray-600'
                    : 'bg-amber-100 text-amber-800'
                  }`}>
                    {r.status === 'armed' ? '● armed' : r.status === 'rejected' ? '✕ rejected' : '◐ shadow'}
                    {r.status_source === 'manual' ? ' (manual)' : ''}
                  </span>
                </div>
              </div>
              <p className="text-sm text-gray-700">{r.rationale}</p>
              {r.recurs_within_days != null && (
                <div className="text-xs text-red-700 bg-red-50 inline-block px-2 py-1 rounded">
                  🔁 recurs ~every {r.recurs_within_days} days ({Math.round(r.recurrence_rate * 100)}% of cases)
                </div>
              )}
              <div className="flex gap-2 pt-1">
                {r.status !== 'armed' && (
                  <button onClick={() => act({ action: 'arm', rule_id: r.id }, `Armed ${r.pattern_key}`)} disabled={busy}
                    className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Arm</button>
                )}
                {r.status !== 'shadow' && (
                  <button onClick={() => act({ action: 'shadow', rule_id: r.id }, `Shadowed ${r.pattern_key}`)} disabled={busy}
                    className="px-3 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">Shadow</button>
                )}
                {r.status !== 'rejected' && (
                  <button onClick={() => act({ action: 'reject', rule_id: r.id }, `Rejected ${r.pattern_key}`)} disabled={busy}
                    className="px-3 py-1 text-xs rounded bg-gray-300 text-gray-700 hover:bg-gray-400 disabled:opacity-50">Reject</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Accuracy by scope */}
      <section>
        <h3 className="font-semibold text-white mb-3">Prediction accuracy by scope</h3>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Scope</th>
                <th className="text-right px-3 py-2">N</th>
                <th className="text-right px-3 py-2">Accurate</th>
                <th className="text-right px-3 py-2">Under</th>
                <th className="text-right px-3 py-2">Over</th>
                <th className="text-right px-3 py-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.accuracy.map((a) => (
                <tr key={a.scope} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs">{a.scope}</td>
                  <td className="px-3 py-2 text-right">{a.n}</td>
                  <td className="px-3 py-2 text-right text-green-700">{a.accurate}</td>
                  <td className="px-3 py-2 text-right text-orange-700">{a.under_predicted}</td>
                  <td className="px-3 py-2 text-right text-blue-700">{a.over_predicted}</td>
                  <td className="px-3 py-2 text-right font-semibold">{Math.round(a.accuracy_rate * 100)}%</td>
                </tr>
              ))}
              {data.accuracy.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No accuracy data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interventions */}
      <section>
        <h3 className="font-semibold text-white mb-3">Which interventions actually work</h3>
        <div className="space-y-2">
          {data.interventions.length === 0 && (
            <div className="text-gray-400 text-sm">No interventions recorded yet.</div>
          )}
          {data.interventions.map((i) => (
            <div key={i.intervention_type} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-sm capitalize">{i.intervention_type.replace(/_/g, ' ')}</div>
                <div className="text-xs text-gray-500">
                  {i.successes}/{i.attempts} worked · {i.recurrences} recurred
                  {i.avg_resolution_hours != null ? ` · ~${i.avg_resolution_hours}h` : ''}
                  {i.avg_cost ? ` · ~£${i.avg_cost}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 min-w-[140px]">
                <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div className={`h-2 ${i.success_rate >= 0.66 ? 'bg-green-500' : i.success_rate >= 0.33 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.round(i.success_rate * 100)}%` }} />
                </div>
                <span className="text-sm font-semibold w-10 text-right">{Math.round(i.success_rate * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'cool' }) {
  const valueColor = tone === 'warn' ? 'text-orange-600' : tone === 'cool' ? 'text-blue-600' : 'text-gray-900';
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
