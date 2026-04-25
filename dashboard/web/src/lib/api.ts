const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface Overview {
  summary: {
    total_trades: number;
    wins: number;
    losses: number;
    open_count: number;
    win_rate: number;
  };
  by_symbol: Array<{ symbol: string; wins: number; losses: number; win_rate: number }>;
  by_timeframe: Array<{ timeframe: string; wins: number; losses: number; win_rate: number }>;
  by_direction: Array<{ direction: string; wins: number; losses: number; win_rate: number }>;
  today_trades: number;
}

export interface Trade {
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

export interface EquityPoint {
  date: string;
  pnl: number;
  cumulative: number;
  symbol: string;
  status: string;
}

export interface HealthCheck {
  status: string;
  checks: Record<string, string>;
  timestamp: string;
}
