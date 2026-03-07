'use client';

import SystemStatsPanel from '@/components/panels/system-stats-panel';

const SystemStatsPage = () => {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">System Statistics</h1>
        <p className="text-muted-foreground mt-2">Real-time resource monitoring and agent fleet status.</p>
      </div>
      
      <SystemStatsPanel />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <div className="panel p-6 bg-card border border-border rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-foreground mb-4">Resource History</h3>
          <div className="h-48 flex items-center justify-center bg-secondary/20 rounded-md border border-dashed border-border text-muted-foreground italic text-sm">
            Load balancing and historical trends visualization coming soon
          </div>
        </div>
        <div className="panel p-6 bg-card border border-border rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-foreground mb-4">Fleet Health</h3>
          <div className="h-48 flex items-center justify-center bg-secondary/20 rounded-md border border-dashed border-border text-muted-foreground italic text-sm">
            Detailed agent health and uptime diagnostics coming soon
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemStatsPage;