#!/usr/bin/env python3
"""
TradingView Webhook Receiver — ICT Futures Scanner
====================================================
Receives POST alerts from TradingView Pine Script and immediately
triggers the futures scanner for the signaled timeframe.

Replaces cron-based polling with event-driven bar-close triggers.
Zero yfinance lag — scanner fires within seconds of bar close.

Endpoints:
  POST /webhook/tv     — TradingView alert (JSON payload)
  GET  /health         — Liveness check
  GET  /status         — Last N alerts received

Deploy:
  python3 tv_webhook.py --port 5001

TradingView Pine Script alert message (JSON):
  {
    "secret":    "{{strategy.order.action}}",   <- set to your WEBHOOK_SECRET
    "symbol":    "{{ticker}}",                  <- ES1!, NQ1!, etc
    "timeframe": "{{interval}}",                <- 15, 60, D
    "price":     {{close}},
    "action":    "scan"
  }

Cloudflare tunnel: webhook.ictwealthbuilding.com → http://localhost:5001
"""

import argparse
import hashlib
import hmac
import json
import logging
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

# ── Config ────────────────────────────────────────────────────────────────────
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")
if not WEBHOOK_SECRET:
    logger.critical("WEBHOOK_SECRET env var is required — refusing to start with no secret")
    sys.exit(1)
SCANNER_PATH   = Path(__file__).parent / "ict_scanner.py"
LOG_PATH = Path("/tmp/tv_webhook.log")
MAX_LOG_ALERTS = 50   # In-memory alert history for /status

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Thread-safe alert history
_alert_lock   = threading.Lock()
_alert_history = []

# Debounce: prevent duplicate triggers within 60s for same symbol/tf
_last_trigger  = {}
_trigger_lock  = threading.Lock()
DEBOUNCE_SECS  = 60

# TradingView interval → our timeframe label
TV_INTERVAL_MAP = {
    "15":  "15m",
    "60":  "1h",
    "D":   "1d",
    "1D":  "1d",
    "1":   None,   # 1m not supported
    "5":   None,   # 5m not supported
}


def _normalize_tf(tv_interval: str) -> str | None:
    """Convert TradingView interval string to scanner timeframe."""
    return TV_INTERVAL_MAP.get(str(tv_interval).strip())


def _trigger_scanner(timeframe: str, source_symbol: str) -> str:
    """
    Run ict_scanner.py for the given timeframe in a subprocess.
    Non-blocking — spawns and returns immediately.
    Returns status string for logging.
    """
    key = f"{source_symbol}:{timeframe}"
    now = datetime.now(timezone.utc).timestamp()

    with _trigger_lock:
        last = _last_trigger.get(key, 0)
        if now - last < DEBOUNCE_SECS:
            return f"debounced ({int(now-last)}s since last trigger)"
        _last_trigger[key] = now

    cmd = [
        sys.executable, str(SCANNER_PATH),
        "--timeframe", timeframe,
        "--source", f"tv_webhook:{source_symbol}",
    ]

    env = {**os.environ}

    def _run():
        try:
            result = subprocess.run(
                cmd, env=env, capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                logger.error(f"Scanner error ({timeframe}): {result.stderr[:300]}")
            else:
                logger.info(f"Scanner completed ({timeframe}): {result.stdout[-200:].strip()}")
        except subprocess.TimeoutExpired:
            logger.error(f"Scanner timed out ({timeframe})")
        except Exception as e:
            logger.error(f"Scanner launch error: {e}")

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return "triggered"


def _log_alert(payload: dict, status: str):
    with _alert_lock:
        _alert_history.append({
            "ts":      datetime.now(timezone.utc).isoformat(),
            "symbol":  payload.get("symbol", "?"),
            "tf":      payload.get("timeframe", "?"),
            "price":   payload.get("price"),
            "status":  status,
        })
        if len(_alert_history) > MAX_LOG_ALERTS:
            _alert_history.pop(0)


class WebhookHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        logger.debug(f"HTTP {fmt % args}")

    def _send(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()})
        elif self.path == "/status":
            with _alert_lock:
                history = list(_alert_history[-20:])
            self._send(200, {"alerts": history, "count": len(history)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/webhook/tv":
            self._send(404, {"error": "not found"})
            return

        # Read body
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            self._send(400, {"error": "empty body"})
            return
        raw = self.rfile.read(length)

        # Parse JSON
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
            return

        # Validate secret
        secret = payload.get("secret", "")
        if secret != WEBHOOK_SECRET:
            logger.warning(f"Invalid secret from {self.client_address[0]}")
            self._send(403, {"error": "forbidden"})
            return

        # Validate timeframe
        tv_tf   = str(payload.get("timeframe", ""))
        our_tf  = _normalize_tf(tv_tf)
        symbol  = payload.get("symbol", "unknown")

        if not our_tf:
            status = f"unsupported timeframe: {tv_tf}"
            logger.info(f"TV alert {symbol} tf={tv_tf} — {status}")
            _log_alert(payload, status)
            self._send(200, {"status": status})
            return

        # Trigger scanner
        status = _trigger_scanner(our_tf, symbol)
        logger.info(f"TV alert {symbol} tf={tv_tf}→{our_tf} price={payload.get('price')} — {status}")
        _log_alert(payload, status)
        self._send(200, {"status": status, "timeframe": our_tf, "symbol": symbol})


def main():
    parser = argparse.ArgumentParser(description="TradingView Webhook Receiver")
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Starting TV webhook receiver on {args.host}:{args.port}")
    logger.info(f"Scanner: {SCANNER_PATH}")
    logger.info(f"Endpoint: POST /webhook/tv")

    server = HTTPServer((args.host, args.port), WebhookHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
