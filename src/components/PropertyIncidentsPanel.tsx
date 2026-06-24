'use client';

import React, { useState, useEffect } from 'react';

interface Incident {
  id: number;
  property_id: string;
  date: string;
  title: string;
  description?: string;
  category: string;
  severity: string;
  status: string;
  reported_by?: string;
  assigned_to?: string;
  resolved_date?: number;
  cost?: number;
  cost_vendor?: string;
  guest_mentions?: number;
  guest_sentiment?: string;
  guest_impact_score?: number;
  validated_by: string[];
  conflicts?: string;
  created_at: number;
}

export function PropertyIncidentsPanel() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  useEffect(() => {
    fetchIncidents();
  }, [selectedProperty, statusFilter, severityFilter]);

  const fetchIncidents = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedProperty) params.append('property_id', selectedProperty);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (severityFilter !== 'all') params.append('severity', severityFilter);
      params.append('limit', '100');

      const response = await fetch(`/api/incidents?${params}`);
      const data = await response.json();

      if (data.incidents) {
        setIncidents(data.incidents);
        // Extract unique properties
        const uniqueProps = [...new Set(data.incidents.map((i: Incident) => i.property_id))];
        setProperties(uniqueProps as string[]);
      }
    } catch (error) {
      console.error('Failed to fetch incidents:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    if (severity === 'critical') return 'bg-red-100 text-red-800';
    if (severity === 'high') return 'bg-orange-100 text-orange-800';
    if (severity === 'medium') return 'bg-yellow-100 text-yellow-800';
    return 'bg-blue-100 text-blue-800';
  };

  const getStatusIcon = (status: string) => {
    if (status === 'resolved') return '✓';
    if (status === 'in_progress') return '→';
    return '○';
  };

  const getValidationBadge = (validatedBy: string[]) => {
    if (!validatedBy || validatedBy.length === 0) return null;
    const icons: Record<string, string> = {
      hugo: '🔧',
      james: '💰',
      iris: '⭐',
      cleo: '💳',
      larry: '👥'
    };
    return validatedBy.map(agent => icons[agent] || '?').join('');
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-4 flex-wrap items-end">
        <div>
          <label className="block text-sm font-medium mb-2">Property</label>
          <select
            value={selectedProperty || ''}
            onChange={(e) => setSelectedProperty(e.target.value || null)}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">All Properties</option>
            {properties.sort().map(prop => (
              <option key={prop} value={prop}>{prop}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Severity</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Incidents List */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-8">Loading incidents...</div>
        ) : incidents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No incidents found</div>
        ) : (
          incidents.map(incident => (
            <div key={incident.id} className="bg-white border border-gray-200 rounded-lg shadow p-4 space-y-3">
              {/* Header */}
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{incident.title}</h3>
                  <p className="text-sm text-gray-500">
                    {incident.property_id} · {incident.date}
                  </p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className={`px-2 py-1 rounded text-sm font-medium ${getSeverityColor(incident.severity)}`}>
                    {incident.severity}
                  </span>
                  <span className={`px-2 py-1 rounded text-sm font-medium ${
                    incident.status === 'resolved' ? 'bg-green-100 text-green-800' :
                    incident.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {incident.status}
                  </span>
                </div>
              </div>

              {/* Description */}
              {incident.description && (
                <p className="text-sm text-gray-700">{incident.description}</p>
              )}

              {/* Details Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {incident.category && (
                  <div className="border-t pt-2">
                    <div className="text-gray-500">Category</div>
                    <div className="font-medium">{incident.category}</div>
                  </div>
                )}

                {incident.cost && (
                  <div className="border-t pt-2">
                    <div className="text-gray-500">Cost</div>
                    <div className="font-medium">£{incident.cost}</div>
                    {incident.cost_vendor && (
                      <div className="text-xs text-gray-500">{incident.cost_vendor}</div>
                    )}
                  </div>
                )}

                {incident.guest_mentions !== undefined && incident.guest_mentions > 0 && (
                  <div className="border-t pt-2">
                    <div className="text-gray-500">Guest Reviews</div>
                    <div className="font-medium">{incident.guest_mentions} mentions</div>
                    {incident.guest_impact_score && (
                      <div className="text-xs">Impact: {incident.guest_impact_score}/10</div>
                    )}
                  </div>
                )}

                {incident.assigned_to && (
                  <div className="border-t pt-2">
                    <div className="text-gray-500">Assigned To</div>
                    <div className="font-medium">{incident.assigned_to}</div>
                  </div>
                )}
              </div>

              {/* Multi-Source Validation */}
              {incident.validated_by && incident.validated_by.length > 0 && (
                <div className="border-t pt-2">
                  <div className="text-sm text-gray-500 mb-1">Validated by:</div>
                  <div className="text-2xl">{getValidationBadge(incident.validated_by)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {incident.validated_by.join(', ')}
                  </div>
                </div>
              )}

              {/* Conflicts */}
              {incident.conflicts && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-sm text-yellow-800">
                  ⚠️ {incident.conflicts}
                </div>
              )}

              {/* Metadata */}
              <div className="text-xs text-gray-400 border-t pt-2">
                Created: {new Date(incident.created_at * 1000).toLocaleDateString()}
                {incident.resolved_date && ` · Resolved: ${new Date(incident.resolved_date * 1000).toLocaleDateString()}`}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
