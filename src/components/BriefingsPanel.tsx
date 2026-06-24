'use client';

import React, { useState, useEffect } from 'react';

interface Briefing {
  id: number;
  agent_name: string;
  date: string;
  content: string;
  urgency_items: any[];
  calendar_items: any[];
  metrics: Record<string, number>;
  posted_at?: number;
  created_at: number;
}

export function BriefingsPanel() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [agents, setAgents] = useState<string[]>([]);

  useEffect(() => {
    fetchBriefings();
  }, [selectedAgent, selectedDate]);

  const fetchBriefings = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedAgent) params.append('agent_name', selectedAgent);
      if (selectedDate) params.append('date', selectedDate);
      params.append('limit', '50');

      const response = await fetch(`/api/briefings?${params}`);
      const data = await response.json();

      if (data.briefings) {
        setBriefings(data.briefings);
        // Extract unique agent names
        const uniqueAgents = [...new Set(data.briefings.map((b: Briefing) => b.agent_name))];
        setAgents(uniqueAgents as string[]);
      }
    } catch (error) {
      console.error('Failed to fetch briefings:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-medium mb-2">Agent</label>
          <select
            value={selectedAgent || ''}
            onChange={(e) => setSelectedAgent(e.target.value || null)}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">All Agents</option>
            {agents.map(agent => (
              <option key={agent} value={agent}>{agent}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      {/* Briefings Grid */}
      <div className="grid gap-4">
        {loading ? (
          <div className="text-center py-8">Loading briefings...</div>
        ) : briefings.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No briefings found</div>
        ) : (
          briefings.map(briefing => (
            <div key={briefing.id} className="bg-white border border-gray-200 rounded-lg shadow">
              <div className="border-b border-gray-200 px-6 py-4">
                <div className="flex justify-between items-start">
                  <h3 className="text-lg font-semibold">{briefing.agent_name} — {briefing.date}</h3>
                  <span className="text-sm font-normal text-gray-500">
                    {briefing.posted_at ? '✓ Posted' : 'Draft'}
                  </span>
                </div>
              </div>
              <div className="px-6 py-4 space-y-4">
                {/* Urgent Items */}
                {briefing.urgency_items && briefing.urgency_items.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-red-600 mb-2">🔴 Urgent Items</h4>
                    <ul className="space-y-1 text-sm">
                      {briefing.urgency_items.map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-2">
                          <span className="text-red-500">•</span>
                          <span>{item.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Calendar Items */}
                {briefing.calendar_items && briefing.calendar_items.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">📅 Calendar</h4>
                    <ul className="space-y-1 text-sm">
                      {briefing.calendar_items.slice(0, 5).map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-2">
                          <span>📌</span>
                          <span>{item.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Metrics */}
                {briefing.metrics && (
                  <div>
                    <h4 className="font-semibold mb-2">📊 Status</h4>
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      <div className="border rounded p-2 text-center">
                        <div className="font-semibold">{briefing.metrics.inProgress || 0}</div>
                        <div className="text-xs text-gray-500">In Progress</div>
                      </div>
                      <div className="border rounded p-2 text-center">
                        <div className="font-semibold">{briefing.metrics.assigned || 0}</div>
                        <div className="text-xs text-gray-500">Assigned</div>
                      </div>
                      <div className="border rounded p-2 text-center">
                        <div className="font-semibold">{briefing.metrics.review || 0}</div>
                        <div className="text-xs text-gray-500">In Review</div>
                      </div>
                      <div className="border rounded p-2 text-center">
                        <div className="font-semibold">{briefing.metrics.completedToday || 0}</div>
                        <div className="text-xs text-gray-500">Done Today</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Full Content */}
                <div className="mt-4 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {briefing.content}
                </div>

                {/* Posted Info */}
                {briefing.posted_at && (
                  <div className="text-xs text-gray-500">
                    Posted: {formatDate(briefing.posted_at)}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
