'use client';

import React, { useState } from 'react';
import { PropertyIncidentsPanel } from './PropertyIncidentsPanel';
import { IncidentLearningPanel } from './IncidentLearningPanel';

export function IncidentsTabs() {
  const [tab, setTab] = useState<'incidents' | 'learning'>('incidents');

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-slate-700">
        {(['incidents', 'learning'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t
                ? 'border-indigo-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'incidents' ? 'Incidents' : '🧠 Learning loop'}
          </button>
        ))}
      </div>

      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        {tab === 'incidents' ? <PropertyIncidentsPanel /> : <IncidentLearningPanel />}
      </div>
    </div>
  );
}
