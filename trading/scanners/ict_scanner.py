"""
Futures Signal Scanner — ES and NQ
ICT Framework (version sourced from /VERSION):
  1. HTF Liquidity Sweep  — 15m uses 1H sweep; 1H uses Daily PDH/PDL; Daily uses prev week H/L
  2. MSS confirmed        — CHoCH after the sweep (bullish or bearish)
  3. Recent FVG           — unmitigated FVG within last 21 candles (post-MSS preferred)
  4. Price in/near FVG    — current price within 0.3% of that FVG zone
  5. Kill Zone active     — London (07–10 UTC) or NY AM (13–16 UTC)

Direction: LONG (SSL swept → bullish setup) or SHORT (BSL swept → bearish setup)
Alert threshold: 4/5 conditions (80%+)
Alert-only — no trade execution.

Usage:
    python3 futures_scanner.py --timeframe 15m
    python3 futures_scanner.py --timeframe 1h
    python3 futures_scanner.py --timeframe 1d
"""

import sys
import os
import argparse
import requests
import pandas as pd
import numpy as np
from datetime import datetime, timezone
import logging

try:
    import yfinance as yf
except ImportError:
    print("yfinance not installed. Run: pip3 install yfinance --break-system-packages")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("futures_scanner")

# Read system version from /VERSION (single source of truth)
_VERSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "VERSION")
try:
    SYSTEM_VERSION = open(_VERSION_FILE).read().strip()
except Exception:
    SYSTEM_VERSION = "unknown"

# ── Config ─────────────────────────────────────────────────────────────────────
WEBHOOKS = {
    "15m": os.environ.get("DISCORD_WEBHOOK_15M",   ""),
    "1h":  os.environ.get("DISCORD_WEBHOOK_1H",    ""),
    "1d":  os.environ.get("DISCORD_WEBHOOK_DAILY", ""),
}

INSTRUMENTS = {
    "ES=F": {"name": "S&P 500 (ES)",    "proxy": "SPY", "emoji": "📈"},
    "NQ=F": {"name": "Nasdaq 100 (NQ)", "proxy": "QQQ", "emoji": "💻"},
    # Phase A (Proposal #10): data collection only — no alerts, no paper trades
    "YM=F": {"name": "Dow Jones (YM)",  "proxy": "DIA", "emoji": "🏛️", "observe_only": True},
}

TIMEFRAME_MAP = {
    "15m": {"yf_interval": "15m", "yf_period": "5d",  "bars": 100, "label": "15-Min  |  Day Trade",   "hold": "Same session"},
    "1h":  {"yf_interval": "1h",  "yf_period": "30d", "bars": 100, "label": "1H  |  Short Swing",     "hold": "1–5 days"},
    "1d":  {"yf_interval": "1d",  "yf_period": "1y",  "bars": 100, "label": "Daily  |  Swing Trade",  "hold": "2–3 weeks"},
}

# HTF reference interval for liquidity sweep detection
# Both 15m and 1H use Daily so sweep references a meaningful multi-week BSL/SSL level.
# Previously 15m used 1H (21 bars = ~21 hours) which was too tight — price rarely takes
# out the 1H extreme within a 2.5h lookback window, so sweep almost never fired.
# Fix (2026-04-10): 15m now uses Daily, with a session-wide lookback (56 bars = 14h)
# so a sweep detected at market open is still known during afternoon scans.
HTF_FOR_TF = {
    "15m": "1d",   # Daily BSL/SSL — meaningful multi-week levels (changed from 1H)
    "1h":  "1d",   # PDH/PDL from daily
    "1d":  "1wk",  # Previous week H/L from weekly
}

# HTF data fetch periods
HTF_PERIOD = {
    "1h":  "7d",
    "1d":  "1mo",
    "1wk": "3mo",
}

FVG_LOOKBACK   = 21    # Gameplan's 21-candle FVG window
# Sweep lookback — 15m uses full trading session (56 bars = 14h covers 7 UTC–21 UTC)
# so a Daily level swept at open is still tracked during afternoon scans.
# 1H and Daily keep a tighter 10-bar lookback (10h and 10d respectively).
SWEEP_LOOKBACK_BY_TF = {
    "15m": 56,
    "1h":  10,
    "1d":  10,
}
SWEEP_LOOKBACK = 10    # Fallback for any unlisted timeframe
FVG_PROXIMITY  = 0.0025 # 0.25% — widened from 0.15% (too tight, missed approaching setups) — price must be within this of FVG zone (tightened from 0.3%)


# ── Data ───────────────────────────────────────────────────────────────────────
def _yf_download_clean(ticker: str, period: str, interval: str, bars: int | None = None) -> pd.DataFrame | None:
    """Download from yfinance, flatten MultiIndex columns, and return clean OHLCV df.
    Returns None on empty/error. Falls back to proxy if primary ticker fails."""
    try:
        df = yf.download(ticker, period=period, interval=interval,
                         progress=False, auto_adjust=True)
        if df is None or df.empty:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.columns = [c.lower() for c in df.columns]
        df = df[["open", "high", "low", "close", "volume"]].dropna()
        return df.tail(bars + 10) if bars else df
    except Exception as e:
        logger.error(f"yf download error {ticker} {interval}: {e}")
        return None


def fetch_bars(ticker: str, timeframe: str, fallback: str | None = None) -> pd.DataFrame | None:
    cfg = TIMEFRAME_MAP[timeframe]
    df = _yf_download_clean(ticker, cfg["yf_period"], cfg["yf_interval"], cfg["bars"])
    if (df is None or df.empty) and fallback:
        logger.warning(f"{ticker} returned no data — falling back to {fallback}")
        df = _yf_download_clean(fallback, cfg["yf_period"], cfg["yf_interval"], cfg["bars"])
    return df


def fetch_htf_bars(ticker: str, timeframe: str, fallback: str | None = None) -> pd.DataFrame | None:
    """Fetch higher-timeframe bars for liquidity sweep reference."""
    htf    = HTF_FOR_TF.get(timeframe, "1d")
    period = HTF_PERIOD.get(htf, "1mo")
    df = _yf_download_clean(ticker, period, htf)
    if (df is None or df.empty) and fallback:
        logger.warning(f"HTF {ticker} returned no data — falling back to {fallback}")
        df = _yf_download_clean(fallback, period, htf)
    return df


# ── Indicators ─────────────────────────────────────────────────────────────────
def ema(s, n):
    return s.ewm(span=n, adjust=False).mean()

def atr(df, n=14):
    h, l, c = df["high"], df["low"], df["close"]
    pc = c.shift(1)
    tr = pd.concat([h-l, (h-pc).abs(), (l-pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1/n, adjust=False).mean()


# ── Condition detectors ────────────────────────────────────────────────────────

def detect_htf_liquidity_sweep(df: pd.DataFrame, htf_df: pd.DataFrame, lookback: int = SWEEP_LOOKBACK) -> dict:
    """
    Condition 1: HTF liquidity sweep.
    Per Gameplan-007 (adjusted v2.11.1): sweep must take out the MAX buy side liquidity
    (highest high) or MIN sell side liquidity (lowest low) across the last 10 completed
    HTF candles.

    Continuation detection (v2.11.1): If BSL is swept but price closes >0.5% above BSL,
    the reversal failed — treat as bullish continuation (strength, not weakness).
    Same logic mirrored for SSL sweeps.

    lookback: how many base-TF bars to check (15m uses 56 = full session, others use 10).
    Returns: {pass, direction, bsl, ssl, detail}
    """
    result = {"pass": False, "direction": None, "level": None, "bsl": None, "ssl": None,
              "detail": "No HTF sweep detected"}
    try:
        if htf_df is None or len(htf_df) < 3:
            result["detail"] = "Insufficient HTF data"
            return result

        # Last 10 completed HTF candles (exclude index -1 which is still forming)
        completed = htf_df.iloc[:-1].tail(10)
        bsl = float(completed["high"].max())  # Max buy side liquidity
        ssl = float(completed["low"].min())   # Min sell side liquidity
        result["bsl"] = bsl
        result["ssl"] = ssl

        recent = df.iloc[-lookback:]
        current_price = float(df["close"].iloc[-1])
        swept_ssl = (recent["low"]  < ssl).any()  # Took out the low
        swept_bsl = (recent["high"] > bsl).any()  # Took out the high

        # Continuation threshold — if price is >0.5% beyond the swept level,
        # the reversal failed and this is a continuation move.
        CONT_THRESHOLD = 0.005  # 0.5%

        if swept_ssl and swept_bsl:
            # Both swept — use current price position to determine direction
            if current_price > bsl:
                result.update({"pass": True, "direction": "bullish", "level": bsl,
                               "detail": f"Both swept — price {current_price:,.2f} above BSL {bsl:,.2f} (bullish bias)"})
            else:
                result.update({"pass": True, "direction": "bearish", "level": ssl,
                               "detail": f"Both swept — price {current_price:,.2f} below SSL {ssl:,.2f} (bearish bias)"})
        elif swept_ssl:
            result.update({"pass": True, "direction": "bullish", "level": ssl,
                           "detail": f"SSL swept — 10-bar low {ssl:,.2f} taken (bullish reversal setup)"})
        elif swept_bsl:
            # BSL swept = normally bearish. But check for continuation.
            pct_above = (current_price - bsl) / bsl
            if pct_above > CONT_THRESHOLD:
                # Price blew through BSL and kept going up — bullish continuation
                result.update({"pass": True, "direction": "bullish", "level": bsl,
                               "detail": f"BSL swept + continuation — price {current_price:,.2f} is {pct_above*100:.1f}% above BSL {bsl:,.2f} (bullish strength)"})
            else:
                # Price is near BSL — could still reverse
                result.update({"pass": True, "direction": "bearish", "level": bsl,
                               "detail": f"BSL swept — 10-bar high {bsl:,.2f} taken (bearish reversal setup)"})
        else:
            result["detail"] = f"No sweep | 10-bar BSL {bsl:,.2f} | SSL {ssl:,.2f}"
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


def detect_mss(df: pd.DataFrame, sweep_direction: str, timeframe: str = "15m") -> dict:
    """
    Condition 2: Market Structure Shift (CHoCH).
    After a bearish sweep (SSL taken), look for price breaking above a swing high = bullish MSS.
    After a bullish sweep (BSL taken), look for price breaking below a swing low = bearish MSS.

    Fractal size is timeframe-aware (ICT multi-bar structure requirement):
    - Daily (1d): 5-candle fractal (n=2) — daily bias requires multi-bar confirmation
    - Intraday (15m, 1h): 3-candle fractal (n=1) — standard ICT CHoCH definition

    The break must be a CLOSE through the level, not just a wick — confirming
    displacement rather than a momentary spike.
    """
    result = {"pass": False, "detail": "No MSS detected", "mss_level": None}
    try:
        # Daily TF requires 5-candle swing fractals; intraday uses 3-candle
        n = 2 if timeframe == "1d" else 1
        fractal_label = "5-candle fractal" if n == 2 else "3-candle fractal"

        window = df.iloc[-21:]
        highs  = window["high"].values
        lows   = window["low"].values
        closes = window["close"].values
        current_close = float(closes[-1])

        if sweep_direction == "bullish":
            swing_highs = []
            for i in range(n, len(highs) - n):
                if all(highs[i] > highs[i - j] and highs[i] > highs[i + j] for j in range(1, n + 1)):
                    swing_highs.append(float(highs[i]))

            if not swing_highs:
                result["detail"] = f"No swing highs found in 21-bar window ({fractal_label})"
                return result

            mss_level = swing_highs[-1]
            if current_close > mss_level:
                result.update({"pass": True, "mss_level": mss_level,
                               "detail": f"Bullish MSS — close {current_close:,.2f} broke above swing high {mss_level:,.2f} ({fractal_label})"})
            else:
                result["detail"] = f"Awaiting bullish MSS above {mss_level:,.2f} (close {current_close:,.2f})"

        elif sweep_direction == "bearish":
            swing_lows = []
            for i in range(n, len(lows) - n):
                if all(lows[i] < lows[i - j] and lows[i] < lows[i + j] for j in range(1, n + 1)):
                    swing_lows.append(float(lows[i]))

            if not swing_lows:
                result["detail"] = f"No swing lows found in 21-bar window ({fractal_label})"
                return result

            mss_level = swing_lows[-1]
            if current_close < mss_level:
                result.update({"pass": True, "mss_level": mss_level,
                               "detail": f"Bearish MSS — close {current_close:,.2f} broke below swing low {mss_level:,.2f} ({fractal_label})"})
            else:
                result["detail"] = f"Awaiting bearish MSS below {mss_level:,.2f} (close {current_close:,.2f})"
        else:
            result["detail"] = "No sweep direction — MSS check skipped"

    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


def detect_recent_fvg(df: pd.DataFrame, direction: str) -> dict:
    """
    Condition 3: Unmitigated FVG within last 21 candles.
    Gameplan: FVG created by energetic MSS impulse, re-entered within 21 candles.
    Bullish FVG: candle[i-2].high < candle[i].low (gap up)
    Bearish FVG: candle[i-2].low > candle[i].high (gap down)
    Returns the nearest unmitigated FVG to current price.
    """
    result = {"pass": False, "fvg_top": None, "fvg_bottom": None,
              "fvg_type": None, "candles_ago": None, "detail": "No recent FVG found"}
    try:
        window = df.iloc[-FVG_LOOKBACK:].reset_index(drop=True)
        current_price = float(df["close"].iloc[-1])
        fvgs = []

        for i in range(2, len(window)):
            h0 = float(window["high"].iloc[i-2])
            l0 = float(window["low"].iloc[i-2])
            h2 = float(window["high"].iloc[i])
            l2 = float(window["low"].iloc[i])

            if direction in ("bullish", None):
                # Bullish FVG: gap between candle[i-2] high and candle[i] low
                if l2 > h0:
                    fvg_bottom = h0
                    fvg_top    = l2
                    mid        = (fvg_bottom + fvg_top) / 2
                    # Mitigation = price returned to the 50% level (Consequent Encroachment).
                    # ICT: CE is the minimum rebalancing threshold, not the absolute edge.
                    subsequent = window["low"].iloc[i:].min() if i < len(window)-1 else current_price
                    mitigated  = subsequent <= mid  # CE (50%), not fvg_bottom
                    if not mitigated:
                        candles_ago = len(window) - 1 - i
                        fvgs.append({"type": "bullish", "top": fvg_top, "bottom": fvg_bottom,
                                     "mid": mid, "candles_ago": candles_ago,
                                     "dist": abs(current_price - mid)})

            if direction in ("bearish", None):
                # Bearish FVG: gap between candle[i-2] low and candle[i] high
                if h2 < l0:
                    fvg_top    = l0
                    fvg_bottom = h2
                    mid        = (fvg_bottom + fvg_top) / 2
                    # Mitigation at 50% (CE) — same logic as bullish, mirror direction
                    subsequent = window["high"].iloc[i:].max() if i < len(window)-1 else current_price
                    mitigated  = subsequent >= mid  # CE (50%), not fvg_top
                    if not mitigated:
                        candles_ago = len(window) - 1 - i
                        fvgs.append({"type": "bearish", "top": fvg_top, "bottom": fvg_bottom,
                                     "mid": mid, "candles_ago": candles_ago,
                                     "dist": abs(current_price - mid)})

        if fvgs:
            # Pick the nearest unmitigated FVG to current price
            best = min(fvgs, key=lambda x: x["dist"])
            result.update({
                "pass": True,
                "fvg_top":     best["top"],
                "fvg_bottom":  best["bottom"],
                "fvg_type":    best["type"],
                "candles_ago": best["candles_ago"],
                "detail":      f"{best['type'].capitalize()} FVG {best['bottom']:,.2f}–{best['top']:,.2f} ({best['candles_ago']} candles ago)"
            })
        else:
            result["detail"] = f"No unmitigated {direction or 'bullish/bearish'} FVG in last {FVG_LOOKBACK} candles"

    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


def detect_price_in_fvg(df: pd.DataFrame, fvg: dict) -> dict:
    """
    Condition 4: Price is inside or within FVG_PROXIMITY of the FVG zone.
    """
    result = {"pass": False, "detail": "Price not near FVG"}
    try:
        if not fvg.get("pass"):
            result["detail"] = "No FVG to check proximity against"
            return result

        price = float(df["close"].iloc[-1])
        top   = fvg["fvg_top"]
        bot   = fvg["fvg_bottom"]
        mid   = (top + bot) / 2
        prox  = mid * FVG_PROXIMITY

        inside  = bot <= price <= top
        nearby  = abs(price - mid) <= prox

        if inside:
            result.update({"pass": True, "detail": f"Price {price:,.2f} INSIDE FVG {bot:,.2f}–{top:,.2f}"})
        elif nearby:
            pct = abs(price - mid) / mid * 100
            result.update({"pass": True, "detail": f"Price {price:,.2f} within {pct:.2f}% of FVG midpoint {mid:,.2f}"})
        else:
            pct = abs(price - mid) / mid * 100
            result["detail"] = f"Price {price:,.2f} is {pct:.2f}% from FVG midpoint — too far ({FVG_PROXIMITY*100:.1f}% threshold)"

    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


def detect_kill_zone() -> dict:
    """Condition 5: ICT Kill Zones — times defined in New York local time.

    London:  2:00 AM – 5:00 AM NY
    NY AM:   7:00 AM – 10:00 AM NY  (core: 8:30–10:00)
    NY PM:   1:30 PM – 4:00 PM NY

    Using NY local time handles EST/EDT automatically.
    """
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo

    now_ny = datetime.now(ZoneInfo("America/New_York"))
    h, m   = now_ny.hour, now_ny.minute
    t      = h * 60 + m  # minutes since midnight NY

    in_london = 2 * 60 <= t < 5 * 60           # 2:00 AM – 5:00 AM NY
    in_ny_am  = 7 * 60 <= t < 10 * 60          # 7:00 AM – 10:00 AM NY
    in_ny_pm  = 13 * 60 + 30 <= t < 16 * 60    # 1:30 PM – 4:00 PM NY
    in_kz     = in_london or in_ny_am or in_ny_pm

    if in_london:   name = "London"
    elif in_ny_am:  name = "NY AM"
    elif in_ny_pm:  name = "NY PM"
    else:           name = "Outside kill zones"

    # Macro time windows — 20-min sub-windows with peak algo activity
    macros = [
        (8*60+50, 9*60+10, "8:50-9:10"),
        (9*60+50, 10*60+10, "9:50-10:10"),
        (10*60+50, 11*60+10, "10:50-11:10"),
        (11*60+50, 12*60+10, "11:50-12:10"),
        (13*60+10, 13*60+40, "1:10-1:40"),
        (14*60+10, 14*60+30, "2:10-2:30"),
        (15*60+0, 15*60+15, "3:00-3:15"),
    ]
    in_macro = False
    macro_name = ""
    for m_start, m_end, m_label in macros:
        if m_start <= t < m_end:
            in_macro = True
            macro_name = m_label
            break

    # Day of week / PO3 phase
    dow = now_ny.weekday()  # 0=Mon, 4=Fri
    dow_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    if dow <= 2:  # Mon-Wed
        po3_phase = "Manipulation (Mon-Wed)"
    elif dow <= 4:  # Thu-Fri
        po3_phase = "Distribution (Thu-Fri)"
    else:
        po3_phase = "Weekend"

    kz_detail = f"NY {now_ny.strftime('%H:%M %Z')} — {'✅ ' + name if in_kz else '❌ ' + name}"
    if in_macro:
        kz_detail += f" | ⚡ Macro {macro_name}"

    return {
        "pass":      in_kz,
        "detail":    kz_detail,
        "macro":     in_macro,
        "macro_name": macro_name if in_macro else None,
        "day_of_week": dow_names[dow],
        "po3_phase": po3_phase,
    }


# ── Trade levels — v2.6 Fib-based OTE extensions ─────────────────────────────
MIN_RR = 1.5  # Minimum R:R gate — trades below this stay HOLD

def _find_energetic_swing(df: pd.DataFrame, direction: str,
                           fvg: dict, sweep_result: dict) -> dict | None:
    """
    Identify the energetic move that created the FVG.
    This is the anchor for Fibonacci extension targets.

    FIX (v2.9): Use local base-TF swing (last 30 bars), NOT the HTF SSL/BSL.
    The HTF level can be hundreds of points away (e.g. 21-day Daily low during a selloff),
    producing 800-pt fib ranges and 20:1 R:R targets that will never be hit on 15m/1H.

    Correct ICT approach: the energetic move is the recent local impulse that created the FVG.
    - Bullish: swing_low  = local base-TF low (last 30 bars, the swept SSL in price action)
               swing_high = FVG top (the impulse high)
    - Bearish: swing_high = local base-TF high (last 30 bars, the swept BSL in price action)
               swing_low  = FVG bottom (the impulse low)
    """
    try:
        window = df.tail(30)
        if direction == "bullish":
            swing_low  = float(window["low"].min())
            swing_high = fvg["fvg_top"]
            if swing_high <= swing_low:
                return None
            return {"high": swing_high, "low": swing_low}
        else:  # bearish
            swing_high = float(window["high"].max())
            swing_low  = fvg["fvg_bottom"]
            if swing_high <= swing_low:
                return None
            return {"high": swing_high, "low": swing_low}
    except Exception as e:
        logger.debug(f"Swing detection error: {e}")
        return None


def _fib_extensions(swing: dict, direction: str) -> dict:
    """
    ICT OTE extension targets from the energetic move.

    ICT levels (Gameplan-007):
      -0.5  = conservative (take 60% of position here)
      -1.0  = intermediate
      -2.0  = runner target

    Bearish:  anchor = swing_low,  extensions go DOWN
    Bullish:  anchor = swing_high, extensions go UP
    """
    r = swing["high"] - swing["low"]
    if r <= 0:
        return {}
    if direction == "bearish":
        a = swing["low"]
        return {
            "eq":  round((swing["high"] + swing["low"]) / 2, 2),  # 50% equilibrium
            "t1":  round(a - 0.5 * r, 2),   # -0.5 conservative
            "t2":  round(a - 1.0 * r, 2),   # -1.0 intermediate
            "t3":  round(a - 2.0 * r, 2),   # -2.0 runner
            "range": round(r, 2),
        }
    else:
        a = swing["high"]
        return {
            "eq":  round((swing["high"] + swing["low"]) / 2, 2),
            "t1":  round(a + 0.5 * r, 2),
            "t2":  round(a + 1.0 * r, 2),
            "t3":  round(a + 2.0 * r, 2),
            "range": round(r, 2),
        }


def _fvg_confluence(df: pd.DataFrame, target_price: float,
                    direction: str, tolerance_pct: float = 0.003) -> bool:
    """
    Check if any unmitigated FVG exists within tolerance_pct of target_price.
    Opposite-direction FVGs at extension targets = high-probability reaction zone.
    """
    try:
        # For bearish targets we look for bullish FVGs (support zones below)
        check_dir = "bullish" if direction == "bearish" else "bearish"
        result = detect_recent_fvg(df.tail(50), check_dir)
        if result.get("pass"):
            mid = (result["fvg_top"] + result["fvg_bottom"]) / 2
            if abs(mid - target_price) / target_price <= tolerance_pct:
                return True
    except Exception:
        pass
    return False


def calc_trade_levels(df: pd.DataFrame, htf_df: pd.DataFrame,
                      direction: str, fvg: dict, atr_val: float,
                      sweep_result: dict = None) -> dict:
    """
    v2.6 — Fibonacci OTE extension targets from the energetic move.

    Entry:  FVG zone (bottom–top)
    Stop:   FVG edge + 0.5× ATR buffer
    T1:     -0.5 fib extension (take 60% here — conservative)
    T2:     -1.0 fib extension (intermediate)
    T3:     -2.0 fib extension (runner)
    R:R:    calculated against T1 (primary target)

    Gameplan principle: in bullish market, SHORTs only target T1 (eq or -0.5).
    In bearish market, target T2 / T3. LONGs always target T1 minimum.
    """
    levels = {"entry_low": None, "entry_high": None,
              "stop": None, "target": None, "rr": None,
              "t1": None, "t2": None, "t3": None,
              "fib_range": None, "t1_fvg_confluence": False}
    try:
        if not (fvg and fvg.get("pass")):
            return levels

        levels["entry_low"]  = fvg["fvg_bottom"]
        levels["entry_high"] = fvg["fvg_top"]
        entry_mid = (fvg["fvg_bottom"] + fvg["fvg_top"]) / 2
        buf = atr_val * 0.5

        # Stop placement
        if direction == "bullish":
            levels["stop"] = round(fvg["fvg_bottom"] - buf, 2)
        else:
            levels["stop"] = round(fvg["fvg_top"] + buf, 2)

        risk = abs(entry_mid - levels["stop"])
        if risk == 0:
            return levels

        # Find the energetic move swing for Fibonacci anchor
        swing = _find_energetic_swing(df, direction, fvg, sweep_result)
        exts  = _fib_extensions(swing, direction) if swing else {}

        if exts:
            levels["t1"]       = exts["t1"]
            levels["t2"]       = exts["t2"]
            levels["t3"]       = exts["t3"]
            levels["fib_range"] = exts["range"]
            # Check FVG confluence at T1 (primary target)
            levels["t1_fvg_confluence"] = _fvg_confluence(df, exts["t1"], direction)
            primary_target = exts["t1"]
        else:
            # Fallback: use HTF structural level capped at 3× risk (v2.5 logic)
            if direction == "bullish":
                htf_bsl = (sweep_result or {}).get("bsl")
                raw = htf_bsl if (htf_bsl and htf_bsl > entry_mid) else float(df.tail(50)["high"].max())
                primary_target = round(min(raw, entry_mid + 3 * risk), 2)
            else:
                htf_ssl = (sweep_result or {}).get("ssl")
                raw = htf_ssl if (htf_ssl and htf_ssl < entry_mid) else float(df.tail(50)["low"].min())
                primary_target = round(max(raw, entry_mid - 3 * risk), 2)

        levels["target"] = primary_target

        reward = abs(primary_target - entry_mid)
        if risk > 0:
            levels["rr"] = round(reward / risk, 1)

    except Exception as e:
        logger.debug(f"Trade levels error: {e}")
    return levels




# ── Volume Imbalance (VIB) Detection ──────────────────────────────────────────
def detect_volume_imbalance(df: pd.DataFrame, direction: str) -> dict:
    """Body-to-body gap between consecutive candles. ICT: 'Wicks do the damage, bodies tell the story.'"""
    result = {"pass": False, "vibs": [], "detail": "No VIB detected"}
    try:
        window = df.iloc[-FVG_LOOKBACK:]
        current_price = float(df["close"].iloc[-1])
        vibs = []

        for i in range(1, len(window)):
            body_prev_high = max(float(window["open"].iloc[i-1]), float(window["close"].iloc[i-1]))
            body_prev_low  = min(float(window["open"].iloc[i-1]), float(window["close"].iloc[i-1]))
            body_curr_high = max(float(window["open"].iloc[i]), float(window["close"].iloc[i]))
            body_curr_low  = min(float(window["open"].iloc[i]), float(window["close"].iloc[i]))

            if direction in ("bullish", None) and body_curr_low > body_prev_high:
                mid = (body_prev_high + body_curr_low) / 2
                vibs.append({"type": "bullish", "top": body_curr_low, "bottom": body_prev_high, "mid": mid,
                             "dist": abs(current_price - mid)})

            if direction in ("bearish", None) and body_curr_high < body_prev_low:
                mid = (body_prev_low + body_curr_high) / 2
                vibs.append({"type": "bearish", "top": body_prev_low, "bottom": body_curr_high, "mid": mid,
                             "dist": abs(current_price - mid)})

        if vibs:
            nearest = min(vibs, key=lambda x: x["dist"])
            result.update({"pass": True, "vibs": vibs[:3],
                           "detail": f"{nearest['type'].capitalize()} VIB {nearest['bottom']:,.2f}-{nearest['top']:,.2f} ({len(vibs)} total)"})
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


# ── Relative Equal Highs/Lows (REH/REL) Detection ────────────────────────────
def detect_reh_rel(df: pd.DataFrame, tolerance_pct: float = 0.001) -> dict:
    """Find clusters of equal highs/lows — concentrated liquidity targets."""
    result = {"reh": [], "rel": [], "detail": "No REH/REL detected"}
    try:
        window = df.iloc[-50:]
        highs = [float(h) for h in window["high"]]
        lows  = [float(l) for l in window["low"]]

        # Find clusters of similar highs
        reh_clusters = []
        for i in range(len(highs)):
            cluster = [highs[i]]
            for j in range(i+1, len(highs)):
                if abs(highs[j] - highs[i]) / highs[i] < tolerance_pct:
                    cluster.append(highs[j])
            if len(cluster) >= 2:
                avg = sum(cluster) / len(cluster)
                if not any(abs(avg - c) / c < tolerance_pct for c in [r["level"] for r in reh_clusters]):
                    reh_clusters.append({"level": round(avg, 2), "count": len(cluster)})

        # Find clusters of similar lows
        rel_clusters = []
        for i in range(len(lows)):
            cluster = [lows[i]]
            for j in range(i+1, len(lows)):
                if abs(lows[j] - lows[i]) / lows[i] < tolerance_pct:
                    cluster.append(lows[j])
            if len(cluster) >= 2:
                avg = sum(cluster) / len(cluster)
                if not any(abs(avg - c) / c < tolerance_pct for c in [r["level"] for r in rel_clusters]):
                    rel_clusters.append({"level": round(avg, 2), "count": len(cluster)})

        reh_clusters.sort(key=lambda x: -x["count"])
        rel_clusters.sort(key=lambda x: -x["count"])

        parts = []
        if reh_clusters:
            parts.append(f"REH: {', '.join(f'{r["level"]:,.2f}({r["count"]}x)' for r in reh_clusters[:3])}")
        if rel_clusters:
            parts.append(f"REL: {', '.join(f'{r["level"]:,.2f}({r["count"]}x)' for r in rel_clusters[:3])}")

        result.update({"reh": reh_clusters[:3], "rel": rel_clusters[:3],
                       "detail": " | ".join(parts) if parts else "No REH/REL detected"})
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


# ── Balance Price Range (BPR) Detection ───────────────────────────────────────
def detect_bpr(df: pd.DataFrame) -> dict:
    """Find overlapping bullish + bearish FVGs — 'most powerful PD Array.'"""
    result = {"pass": False, "bpr_top": None, "bpr_bottom": None, "detail": "No BPR detected"}
    try:
        window = df.iloc[-FVG_LOOKBACK:].reset_index(drop=True)
        bull_fvgs = []
        bear_fvgs = []

        for i in range(2, len(window)):
            h0 = float(window["high"].iloc[i-2])
            l2 = float(window["low"].iloc[i])
            l0 = float(window["low"].iloc[i-2])
            h2 = float(window["high"].iloc[i])

            if l2 > h0:  # Bullish FVG
                bull_fvgs.append({"bottom": h0, "top": l2})
            if h2 < l0:  # Bearish FVG
                bear_fvgs.append({"bottom": h2, "top": l0})

        # Check for overlaps
        for bf in bull_fvgs:
            for brf in bear_fvgs:
                overlap_bottom = max(bf["bottom"], brf["bottom"])
                overlap_top = min(bf["top"], brf["top"])
                if overlap_top > overlap_bottom:
                    result.update({"pass": True, "bpr_bottom": overlap_bottom, "bpr_top": overlap_top,
                                   "detail": f"BPR zone {overlap_bottom:,.2f}-{overlap_top:,.2f} (bull+bear FVG overlap)"})
                    return result
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


# ── New Weekly Opening Gap (NWOG) ─────────────────────────────────────────────
def detect_nwog(ticker: str) -> dict:
    """Gap between Friday close and Sunday/Monday open — weekly price magnet."""
    result = {"pass": False, "nwog_high": None, "nwog_low": None, "price_position": None,
              "detail": "NWOG not available"}
    try:
        df = _yf_download_clean(ticker, "5d", "1d")
        if df is None or len(df) < 2:
            return result

        # Find the gap between the last two daily bars (approximation of weekly gap)
        prev_close = float(df["close"].iloc[-2])
        curr_open  = float(df["open"].iloc[-1])
        current_price = float(df["close"].iloc[-1])

        if abs(prev_close - curr_open) < 0.5:  # No meaningful gap
            result["detail"] = "No weekly opening gap (< 0.5 pts)"
            return result

        nwog_high = max(prev_close, curr_open)
        nwog_low  = min(prev_close, curr_open)

        if current_price > nwog_high:
            position = "ABOVE"
        elif current_price < nwog_low:
            position = "BELOW"
        else:
            position = "INSIDE"

        result.update({
            "pass": True, "nwog_high": nwog_high, "nwog_low": nwog_low,
            "price_position": position,
            "detail": f"NWOG {nwog_low:,.2f}-{nwog_high:,.2f} | Price {position}"
        })
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


# ── HTF Bias Alignment — 20/40 SMA (Proposal #1, Gameplan) ────────────────────

# ── Previous Day High/Low (PDH/PDL) ──────────────────────────────────────────
def detect_pdh_pdl(ticker: str) -> dict:
    """Previous Day High and Low — core ICT reference levels.
    Used as TARGETS (leave a runner), not entry signals.
    If daily swing high is in, target PDL. If swing low is in, target PDH.
    """
    result = {"pdh": None, "pdl": None, "swing_bias": None, "detail": "PDH/PDL not available"}
    try:
        df = _yf_download_clean(ticker, "5d", "1d")
        if df is None or len(df) < 3:
            return result

        # Previous day (completed)
        prev = df.iloc[-2]
        pdh = float(prev["high"])
        pdl = float(prev["low"])
        current_price = float(df["close"].iloc[-1])

        # Daily swing bias: check last 3 completed days for swing high/low
        completed = df.iloc[:-1].tail(3)
        highs = [float(h) for h in completed["high"]]
        lows = [float(l) for l in completed["low"]]

        # Swing high formed if middle day high > both neighbors
        swing_high = len(highs) >= 3 and highs[1] > highs[0] and highs[1] > highs[2]
        # Swing low formed if middle day low < both neighbors
        swing_low = len(lows) >= 3 and lows[1] < lows[0] and lows[1] < lows[2]

        if swing_high and not swing_low:
            swing_bias = "Target PDL (swing high in)"
        elif swing_low and not swing_high:
            swing_bias = "Target PDH (swing low in)"
        else:
            swing_bias = "No clear daily swing"

        result.update({
            "pdh": pdh, "pdl": pdl, "swing_bias": swing_bias,
            "detail": f"PDH {pdh:,.2f} | PDL {pdl:,.2f} | {swing_bias}"
        })
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


# ── CBDR (Central Bank Dealing Range) ─────────────────────────────────────────
def detect_cbdr(ticker: str) -> dict:
    """Central Bank Dealing Range — 6:00-9:00 PM EST previous evening.
    Calculate 5 levels up and 5 levels down from the range.
    First 2 levels are most commonly hit (per Gameplan).
    """
    result = {"range": None, "high": None, "low": None, "levels_up": [], "levels_down": [],
              "detail": "CBDR not available"}
    try:
        # Use 15m data to capture the 6-9 PM window
        df = _yf_download_clean(ticker, "5d", "15m")
        if df is None or len(df) < 50:
            return result

        # Find bars from yesterday 6-9 PM EST (23:00-02:00 UTC, or 22:00-01:00 during EDT)
        from zoneinfo import ZoneInfo
        ny = ZoneInfo("America/New_York")

        df_tz = df.copy()
        if df_tz.index.tz is None:
            df_tz.index = df_tz.index.tz_localize("UTC")
        df_tz.index = df_tz.index.tz_convert(ny)

        from datetime import datetime, timedelta
        now_ny = datetime.now(ny)
        yesterday = now_ny.date() - timedelta(days=1)

        # Filter to 6 PM - 9 PM yesterday
        cbdr_bars = df_tz[
            (df_tz.index.date == yesterday) &
            (df_tz.index.hour >= 18) &
            (df_tz.index.hour < 21)
        ]

        if len(cbdr_bars) == 0:
            result["detail"] = "No CBDR bars found for yesterday 6-9 PM"
            return result

        cbdr_high = float(cbdr_bars["high"].max())
        cbdr_low = float(cbdr_bars["low"].min())
        cbdr_range = cbdr_high - cbdr_low

        if cbdr_range < 0.5:
            result["detail"] = f"CBDR range too small ({cbdr_range:.2f})"
            return result

        # Calculate 5 levels up and 5 levels down
        levels_up = [round(cbdr_high + cbdr_range * i, 2) for i in range(1, 6)]
        levels_down = [round(cbdr_low - cbdr_range * i, 2) for i in range(1, 6)]

        result.update({
            "range": round(cbdr_range, 2),
            "high": cbdr_high,
            "low": cbdr_low,
            "levels_up": levels_up,
            "levels_down": levels_down,
            "detail": f"CBDR {cbdr_low:,.2f}-{cbdr_high:,.2f} (range: {cbdr_range:,.1f} pts) | L1 up: {levels_up[0]:,.2f} | L1 down: {levels_down[0]:,.2f}"
        })
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


# ── Opening Range Gap (ORG) ───────────────────────────────────────────────────
def detect_org(ticker: str) -> dict:
    """Opening Range Gap — gap between today's RTH open and previous session close.
    Used as a price target (ICT: price tends to fill the gap).
    """
    result = {"gap": None, "direction": None, "prev_close": None, "today_open": None,
              "filled": False, "detail": "ORG not available"}
    try:
        df = _yf_download_clean(ticker, "5d", "1d")
        if df is None or len(df) < 2:
            return result

        prev_close = float(df["close"].iloc[-2])
        today_open = float(df["open"].iloc[-1])
        current_price = float(df["close"].iloc[-1])
        gap = today_open - prev_close

        if abs(gap) < 0.5:
            result["detail"] = "No meaningful ORG (< 0.5 pts)"
            return result

        direction = "GAP UP" if gap > 0 else "GAP DOWN"

        # Check if gap has been filled
        if gap > 0:
            filled = float(df["low"].iloc[-1]) <= prev_close
        else:
            filled = float(df["high"].iloc[-1]) >= prev_close

        result.update({
            "gap": round(gap, 2),
            "direction": direction,
            "prev_close": prev_close,
            "today_open": today_open,
            "filled": filled,
            "detail": f"ORG: {direction} {abs(gap):,.1f} pts ({prev_close:,.2f} → {today_open:,.2f}) | {'FILLED' if filled else 'OPEN'}"
        })
    except Exception as e:
        result["detail"] = f"Error: {e}"
    return result


def compute_htf_bias(ticker: str) -> dict:
    """Compute multi-timeframe bias using 20/40 SMA on Weekly, Daily, 1H.

    Returns: {
        "weekly": "BULL" | "BEAR" | "N/A",
        "daily":  "BULL" | "BEAR" | "N/A",
        "1h":     "BULL" | "BEAR" | "N/A",
        "aligned": 0-3,       # how many TFs agree with each other
        "summary": "3/3 BULL" | "2/3 BULL" | etc,
        "risk_suggestion": "Full (2%)" | "Standard (1%)" | "Reduced (0.5%)"
    }
    """
    result = {"weekly": "N/A", "daily": "N/A", "1h": "N/A",
              "aligned": 0, "summary": "N/A", "risk_suggestion": "Standard (1%)"}
    try:
        checks = []
        for tf_name, interval, period in [("weekly", "1wk", "1y"), ("daily", "1d", "3mo"), ("1h", "1h", "30d")]:
            df = _yf_download_clean(ticker, period, interval)
            if df is None or len(df) < 40:
                continue
            sma20 = float(df["close"].tail(20).mean())
            sma40 = float(df["close"].tail(40).mean())
            price = float(df["close"].iloc[-1])

            if price > sma20 and price > sma40:
                result[tf_name] = "BULL"
                checks.append("BULL")
            elif price < sma20 and price < sma40:
                result[tf_name] = "BEAR"
                checks.append("BEAR")
            else:
                result[tf_name] = "MIXED"
                checks.append("MIXED")

        # Count alignment
        bull_count = checks.count("BULL")
        bear_count = checks.count("BEAR")
        if bull_count >= bear_count:
            dominant = "BULL"
            aligned = bull_count
        else:
            dominant = "BEAR"
            aligned = bear_count

        result["aligned"] = aligned
        result["summary"] = f"{aligned}/3 {dominant}"

        if aligned == 3:
            result["risk_suggestion"] = "Full (2%)"
        elif aligned == 2:
            result["risk_suggestion"] = "Standard (1%)"
        else:
            result["risk_suggestion"] = "Reduced (0.5%)"

    except Exception as e:
        logger.debug(f"Bias computation failed for {ticker}: {e}")

    return result


# ── Master signal check ────────────────────────────────────────────────────────
def check_signal(df: pd.DataFrame, htf_df: pd.DataFrame, timeframe: str) -> dict:
    if len(df) < 25:
        return {"signal": "HOLD", "confidence": 0, "conditions": {}, "price": 0, "passed": 0}

    price = float(df["close"].iloc[-1])

    # Run all 5 conditions
    sweep_lb    = SWEEP_LOOKBACK_BY_TF.get(timeframe, SWEEP_LOOKBACK)
    c1_sweep    = detect_htf_liquidity_sweep(df, htf_df, lookback=sweep_lb)

    # If no sweep detected, still evaluate all conditions.
    # Use bullish as default direction for MSS/FVG evaluation (most common setup).
    # Sweep is ONE of 5 conditions, not a chain-breaking gate.
    sweep_dir = c1_sweep.get("direction") or "bullish"
    c2_mss      = detect_mss(df, sweep_dir, timeframe)
    c3_fvg      = detect_recent_fvg(df, sweep_dir)
    c4_fvg_prox = detect_price_in_fvg(df, c3_fvg)
    c5_kz       = detect_kill_zone()

    conditions = {
        "htf_sweep":  c1_sweep,
        "mss":        c2_mss,
        "recent_fvg": c3_fvg,
        "fvg_near":   c4_fvg_prox,
        "kill_zone":  c5_kz,
    }

    passed     = sum(1 for c in conditions.values() if c.get("pass"))
    confidence = int(passed / 5 * 100)
    signal     = "ALERT" if passed >= 4 else "HOLD"

    # ── Hard gates (2026-04-13 / 2026-04-14 / 2026-04-20) ───────────────────────
    # ICT causal chain: Sweep → MSS (CHoCH) → FVG → Entry
    # Missing either breaks the chain. Data confirmed all losses missing one of these two.
    #
    # 1H gate: KZ mandatory — off-hours 1H entries have wide stops, no SM participation
    # 15m gate: MSS mandatory — sweep into FVG without CHoCH = speculation, not ICT
    # 1D gate: KZ EXEMPT — daily candles close at market close, not during intraday sessions.
    #          Kill zones are intraday concepts; applying them to daily signals is a category error.
    #          Daily alerts require 4/4 relevant conditions (sweep, MSS, FVG, price@FVG).
    if timeframe == "1h" and not c5_kz.get("pass") and signal == "ALERT":
        signal     = "HOLD"
        confidence = min(confidence, 79)

    if timeframe == "1d" and signal == "ALERT":
        # For daily: recalculate passed/confidence without KZ, require 4/4
        daily_passed = sum(1 for k, c in conditions.items()
                           if k != "kill_zone" and c.get("pass"))
        if daily_passed < 4:
            signal     = "HOLD"
            confidence = min(confidence, 79)
        else:
            confidence = int(daily_passed / 4 * 100)  # score out of 4 conditions

    if timeframe == "15m" and not c2_mss.get("pass") and signal == "ALERT":
        signal     = "HOLD"
        confidence = min(confidence, 79)

    # ── HTF bias filter — SHORTs only when HTF trend is bearish (2026-04-15) ──
    # In a bull trend, BSL sweeps resolve higher (continuation), not lower (reversal).
    # Require HTF structure to be bearish before allowing SHORT signals:
    # HTF must show price BELOW the 21-bar midpoint (below midrange = bearish bias).
    if sweep_dir == "bearish" and signal == "ALERT" and htf_df is not None and len(htf_df) >= 22:
        htf_completed = htf_df.iloc[:-1].tail(10)  # 10-bar HTF (was 21 — too wide after selloffs)
        htf_mid = (float(htf_completed["high"].max()) + float(htf_completed["low"].min())) / 2
        htf_close = float(htf_df["close"].iloc[-1])
        if htf_close > htf_mid:
            signal     = "HOLD"
            confidence = min(confidence, 79)
            logger.debug(f"SHORT blocked: HTF close {htf_close:,.2f} > HTF midrange {htf_mid:,.2f} — bull bias")

    atr_val    = float(atr(df).iloc[-1])

    # Trade levels — only calculated when alert fires
    trade_levels = calc_trade_levels(df, htf_df, sweep_dir, c3_fvg, atr_val,
                                     sweep_result=c1_sweep) if signal == "ALERT" else {}

    # ── R:R minimum gate (2026-04-15) ─────────────────────────────────────────
    # Trades with R:R < 1.5:1 are not worth taking. Broken target calculation
    # was generating 0.1:1 entries — these are now blocked before alerting.
    if signal == "ALERT" and trade_levels.get("rr") is not None:
        if trade_levels["rr"] < MIN_RR:
            signal     = "HOLD"
            confidence = min(confidence, 79)
            logger.debug(f"Trade blocked: R:R {trade_levels['rr']} < minimum {MIN_RR}")

    # ── PDA gate (Proposal #9, 2026-04-26) ────────────────────────────────────
    # ICT: buy in discount, sell in premium. Reuses HTF bsl/ssl from c1_sweep —
    # no extra data fetch. 0.1% dead band around equilibrium to avoid whipsaws.
    pda_eq   = None
    pda_zone = None
    _pda_bsl = c1_sweep.get("bsl")
    _pda_ssl = c1_sweep.get("ssl")
    if _pda_bsl and _pda_ssl and _pda_bsl > _pda_ssl:
        pda_eq    = round((_pda_bsl + _pda_ssl) / 2, 2)
        _eq_band  = pda_eq * 0.001
        if price > pda_eq + _eq_band:
            pda_zone = "premium"
        elif price < pda_eq - _eq_band:
            pda_zone = "discount"
        else:
            pda_zone = "equilibrium"

    if signal == "ALERT" and pda_zone is not None:
        if sweep_dir == "bullish" and pda_zone == "premium":
            signal     = "HOLD"
            confidence = min(confidence, 79)
            logger.debug(f"LONG blocked by PDA gate: price {price:,.2f} in premium (eq {pda_eq:,.2f})")
        elif sweep_dir == "bearish" and pda_zone == "discount":
            signal     = "HOLD"
            confidence = min(confidence, 79)
            logger.debug(f"SHORT blocked by PDA gate: price {price:,.2f} in discount (eq {pda_eq:,.2f})")

    # Direction label
    direction_label = "📗 LONG" if sweep_dir == "bullish" else "📕 SHORT"

    return {
        "signal":          signal,
        "confidence":      confidence,
        "price":           price,
        "passed":          passed,
        "atr":             atr_val,
        "conditions":      conditions,
        "sweep_dir":       sweep_dir,
        "direction_label": direction_label,
        "fvg":             c3_fvg,
        "trade_levels":    trade_levels,
        "pda_zone":        pda_zone,
        "pda_equilibrium": pda_eq,
    }


# ── Key levels for alert enrichment ───────────────────────────────────────────
def get_key_levels(ticker: str, df: pd.DataFrame, htf_df: pd.DataFrame,
                   sweep_result: dict = None) -> dict:
    levels = {}
    # Pull BSL/SSL directly from sweep result (already computed)
    if sweep_result and sweep_result.get("bsl"):
        levels["bsl"] = sweep_result["bsl"]
        levels["ssl"] = sweep_result["ssl"]
    elif htf_df is not None and len(htf_df) >= 3:
        completed = htf_df.iloc[:-1].tail(10)  # 10-bar HTF (was 21 — too wide after selloffs)
        levels["bsl"] = float(completed["high"].max())
        levels["ssl"] = float(completed["low"].min())
    try:
        if df is not None and len(df) >= 20:
            w = df.tail(20)
            levels["swing_high"] = float(w["high"].max())
            levels["swing_low"]  = float(w["low"].min())
    except Exception:
        pass
    return levels


def format_key_levels(levels: dict, fvg: dict) -> str:
    lines = []
    if "bsl" in levels and "ssl" in levels:
        lines.append(f"BSL (21-bar high) {levels['bsl']:,.2f}  |  SSL (21-bar low) {levels['ssl']:,.2f}")
    if "swing_high" in levels and "swing_low" in levels:
        lines.append(f"20-bar High {levels['swing_high']:,.2f}  |  Low {levels['swing_low']:,.2f}")
    if fvg and fvg.get("pass"):
        arrow = "🔼" if fvg.get("fvg_type") == "bullish" else "🔽"
        lines.append(f"{arrow} Active FVG ({fvg['fvg_type'].capitalize()}): {fvg['fvg_bottom']:,.2f} – {fvg['fvg_top']:,.2f} ({fvg['candles_ago']} candles ago)")
    return "\n".join(lines) if lines else "N/A"


# ── DB Logging ─────────────────────────────────────────────────────────────────
def db_log_signal(symbol, timeframe, sig, proxy=None, channel=None) -> int | None:
    """Log signal + alert. Returns alert_id if an alert was posted, else None."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../.."))
        from shared.db import log_signal, log_alert
        conds = sig.get("conditions", {})
        compat = {
            "breakout":  {"pass": conds.get("htf_sweep",  {}).get("pass", False)},
            "ema":       {"pass": conds.get("mss",        {}).get("pass", False)},
            "rsi":       {"pass": conds.get("recent_fvg", {}).get("pass", False)},
            "volume":    {"pass": conds.get("fvg_near",   {}).get("pass", False)},
            "kill_zone": {"pass": conds.get("kill_zone",  {}).get("pass", False)},
        }
        signal_id = log_signal(
            symbol=symbol, timeframe=timeframe, price=sig.get("price"),
            signal=sig.get("signal"), confidence=sig.get("confidence"),
            passed=sig.get("passed", 0), conditions=compat,
            atr=sig.get("atr"), source="futures_scanner_v2",
        )
        if sig.get("signal") == "ALERT":
            alert_id = log_alert(signal_id, symbol, timeframe, sig.get("price"),
                                 proxy=proxy, discord_channel=channel)
            return alert_id
    except Exception as e:
        logger.debug(f"DB log skipped: {e}")
    return None


MAX_OPEN_PER_INSTRUMENT = 2   # Max open trades across all TFs for one instrument
MAX_DAILY_LOSSES       = 3   # Losses today on one instrument → halt for the day
MAX_HOLD_DAYS          = int(os.getenv("PAPER_TRADE_MAX_HOLD_DAYS", "7"))


def db_log_paper_trade(symbol, timeframe, sig, alert_id=None):
    """Auto-log a 4/5+ paper trade entry with safety rails.

    Gates (checked in order):
      1. Trade levels exist (stop + target)
      2. Same-TF dedup: no OPEN trade on same symbol/timeframe/direction
      3. Position cap: max MAX_OPEN_PER_INSTRUMENT open trades on this instrument
      4. Daily loss halt: MAX_DAILY_LOSSES losses today on this instrument → skip
    """
    try:
        from shared.db import log_paper_trade, get_conn
        tl        = sig.get("trade_levels", {})
        direction = "LONG" if sig.get("sweep_dir") == "bullish" else "SHORT"
        passed    = sig.get("passed", 0)

        if not tl.get("stop") or not tl.get("target"):
            logger.debug("Paper trade: missing trade levels — no FVG or stop/target calc failed")
            return

        # Use BEGIN IMMEDIATE for atomic checks (prevents TOCTOU race between
        # concurrent webhook + cron runs).
        conn = get_conn()
        conn.execute("BEGIN IMMEDIATE")

        # Gate 1: Same-TF dedup — one open trade per symbol/timeframe/direction
        existing = conn.execute(
            "SELECT id FROM paper_trades WHERE symbol=? AND timeframe=? AND direction=? AND status='OPEN'",
            (symbol, timeframe, direction)
        ).fetchone()
        if existing:
            conn.rollback()
            conn.close()
            logger.info(f"SKIP {symbol} {timeframe} {direction}: same-TF dedup (#{existing[0]} already open)")
            return

        # Gate 2: Position cap — max open trades per instrument across all TFs
        open_count = conn.execute(
            "SELECT COUNT(*) FROM paper_trades WHERE symbol=? AND status='OPEN'",
            (symbol,)
        ).fetchone()[0]
        if open_count >= MAX_OPEN_PER_INSTRUMENT:
            conn.rollback()
            conn.close()
            logger.info(f"SKIP {symbol} {timeframe} {direction}: position cap ({open_count}/{MAX_OPEN_PER_INSTRUMENT} open)")
            return

        # Gate 3: Daily loss halt — too many losses today on this instrument
        today_losses = conn.execute(
            "SELECT COUNT(*) FROM paper_trades WHERE symbol=? AND status='LOSS' AND date(ts_exit)=date('now')",
            (symbol,)
        ).fetchone()[0]
        if today_losses >= MAX_DAILY_LOSSES:
            conn.rollback()
            conn.close()
            logger.info(f"SKIP {symbol} {timeframe} {direction}: daily loss halt ({today_losses} losses today)")
            return

        conn.commit()
        conn.close()

        kz_active      = sig.get("conditions", {}).get("kill_zone", {}).get("pass", False)
        bias_alignment = sig.get("bias", {}).get("aligned")
        notes          = f"{passed}/5 | KZ={'active' if kz_active else 'inactive'}"

        # Entry price = FVG midpoint (where a trader actually executes), not bar close.
        # Bar close may be 50-100pts away from FVG on approach; measuring P&L from
        # bar close produces misleading win/loss magnitudes.
        fvg_mid = (tl.get("entry_low", 0) + tl.get("entry_high", 0)) / 2 if tl.get("entry_low") else sig.get("price")
        trade_id = log_paper_trade(
            symbol=symbol, timeframe=timeframe, direction=direction,
            entry_price=round(fvg_mid, 2),
            entry_low=tl.get("entry_low"), entry_high=tl.get("entry_high"),
            stop_price=tl["stop"], target_price=tl["target"],
            atr=sig.get("atr"), alert_id=alert_id,
            confidence=sig.get("confidence"),
            kz_active=int(kz_active),
            notes=notes,
            bias_alignment=bias_alignment,
        )
        logger.info(f"Paper trade logged: {symbol} {direction} #{trade_id} [{notes}] | "
                    f"entry {sig['price']:,.2f} stop {tl['stop']:,.2f} target {tl['target']:,.2f}")
    except Exception as e:
        logger.debug(f"Paper trade log failed: {e}")


def db_check_open_paper_trades(current_prices: dict):
    """Check open paper trades and resolve WIN / LOSS / EXPIRED.

    Resolution is CLOSE-BASED: ``current_prices[sym]`` is the bar's *closing*
    price as reported by ``fetch_bars()`` → ``sig["price"]``.  A wick that
    pierces the stop or target intrabar does NOT trigger resolution; the bar
    must close through the level.  This matches ICT's confirmation model but
    means paper P&L will occasionally differ from live execution, where a
    stop-market order can fill on a wick.

    Expiry: trades open >= MAX_HOLD_DAYS calendar days resolve as EXPIRED
    (not LOSS) at the current market price so win-rate stats stay clean.
    MAX_HOLD_DAYS is controlled by the PAPER_TRADE_MAX_HOLD_DAYS env var
    (default 7).
    """
    try:
        from shared.db import get_open_paper_trades, resolve_paper_trade
        open_trades = get_open_paper_trades()
        now = datetime.now(timezone.utc)
        for t in open_trades:
            sym   = t["symbol"]

            # Max hold time → expire using current market price, not entry price.
            # Status is EXPIRED (not LOSS) so win rate stats stay clean.
            try:
                entry_ts = datetime.fromisoformat(t["ts_entry"].replace("Z", "+00:00"))
                if (now - entry_ts).days >= MAX_HOLD_DAYS:
                    exit_price = current_prices.get(sym) or t["entry_price"]
                    resolve_paper_trade(t["id"], exit_price, "EXPIRED", sym)
                    logger.info(f"Paper trade #{t['id']} {sym} → EXPIRED ({MAX_HOLD_DAYS}d) @ {exit_price:,.2f}")
                    continue
            except Exception:
                pass

            price = current_prices.get(sym)
            if price is None:
                continue
            hit_target = (t["direction"] == "LONG"  and price >= t["target_price"]) or \
                         (t["direction"] == "SHORT" and price <= t["target_price"])
            hit_stop   = (t["direction"] == "LONG"  and price <= t["stop_price"]) or \
                         (t["direction"] == "SHORT" and price >= t["stop_price"])
            if hit_target:
                resolve_paper_trade(t["id"], price, "WIN", sym)
                logger.info(f"Paper trade #{t['id']} {sym} → WIN @ {price:,.2f}")
            elif hit_stop:
                resolve_paper_trade(t["id"], price, "LOSS", sym)
                logger.info(f"Paper trade #{t['id']} {sym} → LOSS @ {price:,.2f}")
    except Exception as e:
        logger.debug(f"Paper trade check failed: {e}")


# ── Discord post ───────────────────────────────────────────────────────────────
def post_discord(webhook: str, ticker: str, timeframe: str, sig: dict,
                 levels: dict = None):
    info      = INSTRUMENTS[ticker]
    cfg       = TIMEFRAME_MAP[timeframe]
    conds     = sig["conditions"]
    passed    = sig["passed"]
    price     = sig["price"]
    direction = sig.get("direction_label", "📗 LONG")
    tl        = sig.get("trade_levels", {})
    is_long   = sig.get("sweep_dir") == "bullish"

    def c(k): return "✅" if conds[k]["pass"] else "❌"

    # Green for long/5-of-5, red for short, amber for 4-of-5 long
    if not is_long:
        color = 0xe74c3c  # red — short
    elif passed >= 5:
        color = 0x00c851  # bright green — 5/5 long
    else:
        color = 0xffbb33  # amber — 4/5 long

    key_levels_str = format_key_levels(levels or {}, sig.get("fvg"))
    pda_zone = sig.get("pda_zone")
    pda_eq   = sig.get("pda_equilibrium")
    if pda_zone and pda_eq:
        zone_icon = "🟢" if pda_zone == "discount" else ("🔴" if pda_zone == "premium" else "🟡")
        key_levels_str += f"\n{zone_icon} PDA: {pda_zone.upper()} | Eq {pda_eq:,.2f}"

    # Trade plan string — v2.6 tiered fib targets
    if tl.get("entry_low") and tl.get("stop") and tl.get("target"):
        rr_str = f" | R:R {tl['rr']}:1" if tl.get("rr") else ""
        fib_range_str = f" (fib range: {tl['fib_range']:,.0f} pts)" if tl.get("fib_range") else ""
        t1_conf = " ⚡FVG" if tl.get("t1_fvg_confluence") else ""
        if tl.get("t1") and tl.get("t2") and tl.get("t3"):
            # Full fib targets available
            trade_plan = (
                f"**Entry:** {tl['entry_low']:,.2f} – {tl['entry_high']:,.2f}\n"
                f"**Stop:** {tl['stop']:,.2f}\n"
                f"**T1 (−0.5):** {tl['t1']:,.2f}{t1_conf} ← take 60%{rr_str}\n"
                f"**T2 (−1.0):** {tl['t2']:,.2f}\n"
                f"**T3 (−2.0):** {tl['t3']:,.2f} ← runner{fib_range_str}"
            )
        else:
            # Fallback — single target
            trade_plan = (
                f"**Entry:** {tl['entry_low']:,.2f} – {tl['entry_high']:,.2f}\n"
                f"**Stop:** {tl['stop']:,.2f} | **Target:** {tl['target']:,.2f}{rr_str}"
            )
    else:
        trade_plan = "Entry zone: FVG level (see conditions)\nStop: Beyond FVG  •  Targets: Fib extensions below"

    # Reference levels
    ref = sig.get("reference_levels", {})
    ref_parts = []

    pdh_pdl = ref.get("pdh_pdl", {})
    if pdh_pdl.get("pdh"):
        ref_parts.append(f"\U0001f4ca PDH: {pdh_pdl["pdh"]:,.2f} | PDL: {pdh_pdl["pdl"]:,.2f}")
        if pdh_pdl.get("swing_bias"):
            ref_parts.append(f"   {pdh_pdl["swing_bias"]}")

    cbdr = ref.get("cbdr", {})
    if cbdr.get("range"):
        ref_parts.append(f"\U0001f3e6 CBDR: {cbdr["low"]:,.2f}-{cbdr["high"]:,.2f} (range: {cbdr["range"]:,.1f})")
        if cbdr.get("levels_up"):
            ref_parts.append(f"   L1\u2191 {cbdr["levels_up"][0]:,.2f} | L2\u2191 {cbdr["levels_up"][1]:,.2f}")
            ref_parts.append(f"   L1\u2193 {cbdr["levels_down"][0]:,.2f} | L2\u2193 {cbdr["levels_down"][1]:,.2f}")

    org_data = ref.get("org", {})
    if org_data.get("gap"):
        fill_icon = "\u2705" if org_data["filled"] else "\u26aa"
        ref_parts.append(f"\U0001f4c8 ORG: {org_data["direction"]} {abs(org_data["gap"]):,.1f} pts {fill_icon}")

    ref_str = "\n".join(ref_parts) if ref_parts else "Reference levels unavailable"

    # Confluence enrichment
    conf = sig.get("confluence", {})
    conf_parts = []

    # Kill zone extras
    kz_data = conds.get("kill_zone", {})
    if kz_data.get("macro"):
        conf_parts.append(f"⚡ Macro window: {kz_data['macro_name']}")
    if kz_data.get("po3_phase"):
        conf_parts.append(f"📅 {kz_data['day_of_week']} — {kz_data['po3_phase']}")

    # VIB
    vib = conf.get("vib", {})
    if vib.get("pass"):
        conf_parts.append(f"📊 VIB: {vib['detail']}")

    # BPR
    bpr = conf.get("bpr", {})
    if bpr.get("pass"):
        conf_parts.append(f"🔥 BPR: {bpr['detail']}")

    # REH/REL
    reh_rel = conf.get("reh_rel", {})
    if reh_rel.get("reh") or reh_rel.get("rel"):
        conf_parts.append(f"🎯 {reh_rel['detail']}")

    # NWOG
    nwog = conf.get("nwog", {})
    if nwog.get("pass"):
        conf_parts.append(f"📐 {nwog['detail']}")

    confluence_str = "\n".join(conf_parts) if conf_parts else "No additional confluence detected"

    # HTF Bias alignment
    bias = sig.get("bias", {})
    if bias.get("summary", "N/A") != "N/A":
        bias_icon = "\U0001f7e2" if bias.get("aligned", 0) == 3 else ("\U0001f7e1" if bias.get("aligned", 0) == 2 else "\U0001f534")
        trade_dir = "BULL" if is_long else "BEAR"
        with_trend = trade_dir in bias.get("summary", "")
        trend_note = "WITH trend \u2714" if with_trend else "AGAINST trend \u26a0"
        bias_str = (
            f"{bias_icon} **{bias.get('summary', 'N/A')}** — {trend_note}\n"
            f"Weekly: {bias.get('weekly', 'N/A')} | Daily: {bias.get('daily', 'N/A')} | 1H: {bias.get('1h', 'N/A')}\n"
            f"Risk suggestion: {bias.get('risk_suggestion', 'Standard (1%)')}"
        )
    else:
        bias_str = "Bias data unavailable"

    action_verb = "buy" if is_long else "sell/short"

    fields = [
        {"name": "Direction",     "value": direction,                  "inline": True},
        {"name": "Futures Price", "value": f"{price:,.2f}",            "inline": True},
        {"name": "Confidence",    "value": f"{passed}/5 — {sig['confidence']}%", "inline": True},
        {"name": "HTF Sweep",   "value": f"{c('htf_sweep')} {conds['htf_sweep']['detail']}",   "inline": False},
        {"name": "MSS",         "value": f"{c('mss')} {conds['mss']['detail']}",               "inline": False},
        {"name": "Recent FVG",  "value": f"{c('recent_fvg')} {conds['recent_fvg']['detail']}", "inline": False},
        {"name": "Price @ FVG", "value": f"{c('fvg_near')} {conds['fvg_near']['detail']}",     "inline": False},
        {"name": "Kill Zone",   "value": f"{c('kill_zone')} {conds['kill_zone']['detail']}",   "inline": False},
        {"name": "📍 Key Levels", "value": key_levels_str,                                      "inline": False},
        {"name": "🎯 Trade Plan", "value": trade_plan,                                          "inline": False},
        {"name": "⚠️ Action",    "value": f"**Chart {ticker} — {action_verb} {info['proxy']} if confirmed.** Signal alert only — you decide.", "inline": False},
    ]

    embed = {
        "embeds": [{
            "title": f"{info['emoji']} {'🟢 LONG' if is_long else '🔴 SHORT'} Alert — {info['name']}",
            "description": (
                f"**{cfg['label']}**  •  Typical hold: {cfg['hold']}\n"
                f"Signal from **{ticker}** futures → execute on **{info['proxy']}**\n"
                f"*ICT: HTF Sweep → MSS (CHoCH) → FVG retest → Kill Zone*"
            ),
            "color":  color,
            "fields": fields,
            "footer": {"text": f"Not financial advice. Educational use only. Futures trading involves substantial risk of loss. • ICT Scanner v{SYSTEM_VERSION} • {timeframe.upper()} • {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"},
        }]
    }

    try:
        r = requests.post(webhook, json=embed, timeout=10)
        r.raise_for_status()
        logger.info(f"Posted {direction} alert: {ticker} {timeframe} {passed}/5")
    except Exception as e:
        logger.error(f"Discord post failed: {e}")


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeframe", required=True, choices=["15m", "1h", "1d"])
    parser.add_argument("--source", default="cron", help="Trigger source: cron or tv_webhook:SYMBOL")
    args = parser.parse_args()
    tf   = args.timeframe

    webhook = WEBHOOKS.get(tf, "")
    if not webhook:
        logger.error(f"No webhook for {tf}")
        sys.exit(1)

    # Session gate for 15m — London open through US close (07:00–21:00 UTC)
    # FIX: was 12-21 UTC which blocked London kill zone (07-10 UTC) entirely
    now_utc = datetime.now(timezone.utc)
    if tf == "15m" and not (7 <= now_utc.hour < 21):
        logger.info(f"15m scanner outside session hours ({now_utc.hour}:xx UTC) — skipping")
        return

    fired          = False
    current_prices = {}
    scan_results   = {}  # collects all sig dicts for SMT divergence logging

    for ticker in INSTRUMENTS:
        info         = INSTRUMENTS[ticker]
        proxy        = info["proxy"]
        observe_only = info.get("observe_only", False)

        df     = fetch_bars(ticker, tf, fallback=proxy)
        htf_df = fetch_htf_bars(ticker, tf, fallback=proxy)

        if df is None or len(df) < 5:
            logger.warning(f"No data for {ticker}")
            continue

        sig  = check_signal(df, htf_df, tf)
        bias = compute_htf_bias(ticker)
        sig["bias"] = bias

        pdh_pdl = detect_pdh_pdl(ticker)
        cbdr    = detect_cbdr(ticker)
        org     = detect_org(ticker)
        sig["reference_levels"] = {"pdh_pdl": pdh_pdl, "cbdr": cbdr, "org": org}

        vib    = detect_volume_imbalance(df, sig.get("sweep_dir"))
        reh_rel = detect_reh_rel(df)
        bpr    = detect_bpr(df)
        nwog   = detect_nwog(ticker)
        sig["confluence"] = {"vib": vib, "reh_rel": reh_rel, "bpr": bpr, "nwog": nwog}

        levels = get_key_levels(ticker, df, htf_df,
                                sweep_result=sig.get("conditions", {}).get("htf_sweep"))
        current_prices[ticker] = sig["price"]
        scan_results[ticker]   = sig

        obs_label = " [observe-only]" if observe_only else ""
        logger.info(f"{ticker}{obs_label} | {tf} | {sig['signal']} | {sig['passed']}/5 | "
                    f"conf {sig['confidence']}% | sweep={sig.get('sweep_dir')} | "
                    f"dir={sig.get('direction_label')} | bias={sig.get('bias', {}).get('summary', 'N/A')}")

        alert_id = db_log_signal(ticker, tf, sig, proxy=proxy, channel=tf)

        # observe_only instruments are logged above but never alert or execute
        if observe_only:
            continue

        if sig["signal"] == "ALERT":
            post_discord(webhook, ticker, tf, sig, levels=levels)
            fired = True
            if sig["passed"] >= 4:
                try:
                    from execution.router import route_signal
                    route_signal(ticker, tf, sig, alert_id=alert_id)
                except ImportError:
                    db_log_paper_trade(ticker, tf, sig, alert_id=alert_id)

    # Check all open paper trades against current prices
    db_check_open_paper_trades(current_prices)

    # Log SMT divergence snapshot (Phase A — data collection, no signal impact)
    try:
        from shared.db import log_smt_divergence
        log_smt_divergence(tf, scan_results)
    except Exception as e:
        logger.debug(f"SMT divergence log skipped: {e}")

    if not fired:
        logger.info(f"No alerts — silent ({tf})")


if __name__ == "__main__":
    main()
