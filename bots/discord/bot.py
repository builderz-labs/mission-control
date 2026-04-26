"""
ICT Trading Discord Bot — Captain Hook
Purpose: Let the ICT trading group interact with Claude — ask questions,
view stats, propose changes, run research. Code changes gated through Ross.

Architecture: Standalone discord.py bot using Anthropic API directly.
Version comes from /VERSION via engine.version (no hardcoded version strings).
"""
import asyncio
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

import subprocess
import sys
sys.path.insert(0, "/opt")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from llm_failover import llm_call
from engine.version import __version__
import asyncio
import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ict-bot")

# ── Config ────────────────────────────────────────────────────────────────────
DISCORD_TOKEN = os.getenv("DISCORD_BOT_TOKEN")
# ANTHROPIC_KEY removed — using Claude CLI pipe mode (Max subscription)
BRAVE_KEY = os.getenv("BRAVE_API_KEY")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_ROSS_ID = os.getenv("TELEGRAM_ROSS_ID")
TRADING_DB = os.getenv("TRADING_DB_PATH", "/opt/trading-workspace/trading/data/trading.db")
ADMIN_ID = int(os.getenv("DISCORD_ADMIN_ID", "0")) or None
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
BOT_DB = Path(__file__).parent / "bot.db"

# ── Anthropic client ──────────────────────────────────────────────────────────
# Claude CLI pipe mode — uses Max subscription, not API key

ICT_SYSTEM_PROMPT_TEMPLATE = """You are Captain Hook, the ICT trading assistant for the Wealth Building with ICT Discord group.
You have deep knowledge of ICT methodology AND our specific scanner implementation (v{version}).

## OUR SYSTEM — ICT Scanner v{version}

**Instruments:** ES=F (S&P 500 futures) and NQ=F (Nasdaq 100 futures)
**Execution proxies:** SPY and QQQ (via Alpaca, paper trading — NOT live yet)
**Timeframes scanned:** 15m, 1H, Daily
**Data source:** TradingView webhooks (real-time bar close) + cron backup

### The 5-Condition Chain
Every signal requires 4 or 5 of these conditions to fire an ALERT:

1. **HTF Liquidity Sweep** — Price takes out the 10-bar Daily BSL or SSL. BSL swept = bearish reversal setup. SSL swept = bullish reversal setup. Continuation detection: if BSL swept but price continues >0.5% above, flips to bullish (strength signal).

2. **MSS / CHoCH** — After the sweep, price must close above/below a prior 3-candle swing fractal. Close-based confirmation prevents wick fakeouts.

3. **Unmitigated FVG** — 3-candle Fair Value Gap within last 21 candles. Mitigation at 50% (Consequent Encroachment).

4. **Price at FVG** — Current price within 0.25% of FVG midpoint.

5. **Kill Zone Active** — London (2-5 AM NY), NY AM (7-10 AM NY), NY PM (1:30-4 PM NY). Daily exempt.

### Hard Gates
- 1H KZ gate: 1H signals require KZ active
- 15m MSS gate: 15m signals require MSS confirmed
- HTF bias filter: SHORTs only when HTF close below 21-bar midrange
- R:R minimum: 1.5:1 required
- PDA gate: LONGs blocked when price is in premium (above HTF dealing-range midpoint); SHORTs blocked when price is in discount (below midpoint). 0.1% dead band at equilibrium. Every alert shows PDA zone (DISCOUNT/PREMIUM/EQUILIBRIUM) + equilibrium level.

### Trade Levels (Fibonacci OTE)
- Entry: FVG midpoint
- Stop: FVG edge +/- 0.5x ATR(14)
- T1 (-0.5 fib): Take 60%, R:R calculated against this
- T2 (-1.0): Intermediate
- T3 (-2.0): Runner
- Swing anchor: local 30-bar base-timeframe swing

### Reference Levels
- **PDH/PDL**: Previous Day High/Low with daily swing bias ("swing high in = target PDL")
- **CBDR**: Central Bank Dealing Range (6-9 PM EST). 5 levels up, 5 down. L1/L2 most common.
- **ORG**: Opening Range Gap (today's open vs previous close). Tracks if filled.

### Confluence Features
- **VIB**: Volume Imbalance (body-to-body gaps)
- **BPR**: Balance Price Range (overlapping bull+bear FVGs)
- **REH/REL**: Relative Equal Highs/Lows (liquidity pools)
- **NWOG**: New Weekly Opening Gap
- **Macro times**: 20-min sub-windows within kill zones
- **PO3 phase**: Mon-Wed manipulation vs Thu-Fri distribution

### HTF Bias Alignment
- 20/40 SMA on Weekly, Daily, 1H
- 3/3 aligned = full risk (2%), 2/3 = standard (1%), 1/3 = reduced (0.5%)

### Paper Trading
Auto-logs at 4/5+ conditions. Entry at FVG midpoint, resolves when price hits T1 (WIN) or stop (LOSS). 7-day max hold. Checked every 15 min.

### Current Performance
{perf_stats}

## YOUR ROLE
- Help group members understand signals, conditions, and ICT concepts
- Reference OUR current scanner implementation specifically
- Use trading data provided in context (open trades, win rate, P&L)
- Keep answers concise — bullet points
- Do NOT give trade advice (buy/sell). Explain concepts and analysis.
- Encourage /propose for change requests so Ross can review"""


def _fetch_perf_stats() -> str:
    """Query trading DB for live win-rate and P&L stats."""
    try:
        conn = sqlite3.connect(TRADING_DB)

        def wr(extra: str = "") -> tuple[int, int, int]:
            t = conn.execute(
                f"SELECT COUNT(*) FROM paper_trades WHERE status IN ('WIN','LOSS') {extra}"
            ).fetchone()[0]
            w = conn.execute(
                f"SELECT COUNT(*) FROM paper_trades WHERE status='WIN' {extra}"
            ).fetchone()[0]
            return t, w, round(w / t * 100) if t else 0

        total, wins, pct     = wr()
        _, _, pct_es         = wr("AND symbol='ES=F'")
        t_es, _, _           = wr("AND symbol='ES=F'")
        _, _, pct_nq         = wr("AND symbol='NQ=F'")
        t_nq, _, _           = wr("AND symbol='NQ=F'")
        _, _, pct_long       = wr("AND direction='LONG'")
        _, _, pct_short      = wr("AND direction='SHORT'")
        pnl = round(
            conn.execute(
                "SELECT SUM(pnl_pts) FROM paper_trades WHERE status IN ('WIN','LOSS')"
            ).fetchone()[0] or 0, 1
        )
        conn.close()

        return (
            f"Overall: {pct}% WR | ES: {pct_es}% WR ({t_es} trades) | "
            f"NQ: {pct_nq}% WR ({t_nq} trades) | LONG: {pct_long}% WR | SHORT: {pct_short}% WR\n"
            f"Total P&L: +{pnl} pts across {total} closed trades. Forward test ongoing."
        )
    except Exception as e:
        return f"Performance data unavailable ({e})"


_perf_stats_cache: str = _fetch_perf_stats()
_perf_stats_refreshed_at: float = 0.0


def get_system_prompt() -> str:
    """Return the system prompt with live stats, refreshing cache every hour."""
    import time
    global _perf_stats_cache, _perf_stats_refreshed_at
    if time.time() - _perf_stats_refreshed_at > 3600:
        _perf_stats_cache = _fetch_perf_stats()
        _perf_stats_refreshed_at = time.time()
    return ICT_SYSTEM_PROMPT_TEMPLATE.format(version=__version__, perf_stats=_perf_stats_cache)


ICT_SYSTEM_PROMPT = get_system_prompt()

# ── Bot setup ─────────────────────────────────────────────────────────────────
intents = discord.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)


# ── Database ──────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(BOT_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS proposals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL DEFAULT (datetime('now')),
            discord_user TEXT NOT NULL,
            discord_user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            ross_response TEXT,
            telegram_msg_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL DEFAULT (datetime('now')),
            message_id INTEGER NOT NULL,
            channel_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            reaction TEXT NOT NULL,
            UNIQUE(message_id, user_id, reaction)
        )
    """)
    conn.commit()
    conn.close()


# ── Helpers ───────────────────────────────────────────────────────────────────
async def send_telegram(text: str) -> int | None:
    """Send a message to Ross via Telegram. Returns message_id."""
    # Log proposal to file for pickup by active session
    try:
        with open('/var/log/ict-proposals.log', 'a') as f:
            from datetime import datetime, timezone
            f.write(f'{datetime.now(timezone.utc).isoformat()} | {text[:200]}\n')
    except:
        pass
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_ROSS_ID, "text": text, "parse_mode": "HTML"},
                timeout=10,
            )
            data = resp.json()
            if data.get("ok"):
                return data["result"]["message_id"]
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
    return None

def query_trading_db(sql: str, params: tuple = ()) -> list[dict]:
    """Query the trading database (read-only)."""
    try:
        conn = sqlite3.connect(TRADING_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Trading DB query failed: {e}")
        return []


def brave_search(query: str, count: int = 5) -> list[dict]:
    """Search via Brave API."""
    url = f"https://api.search.brave.com/res/v1/web/search?q={quote_plus(query)}&count={count}"
    req = Request(url)
    req.add_header("Accept", "application/json")
    req.add_header("X-Subscription-Token", BRAVE_KEY)
    try:
        import json
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        results = []
        for r in data.get("web", {}).get("results", [])[:count]:
            results.append({"title": r.get("title", ""), "url": r.get("url", ""), "desc": r.get("description", "")[:200]})
        for r in data.get("discussions", {}).get("results", [])[:3]:
            d = r.get("data", {})
            results.append({"title": d.get("title", r.get("title", "")), "url": r.get("url", ""), "desc": d.get("question", "")[:200]})
        return results
    except Exception as e:
        logger.error(f"Brave search failed: {e}")
        return []


# ── Events ────────────────────────────────────────────────────────────────────
ALERTS_CHANNEL_ID = 1485750310160040036  # #ict-bot-alerts

DECISION_ECHO_TEMPLATE = {
    "APPROVED":  "✅ <@{user_id}> Proposal #{id} **{title}** — approved by Ross. Queued for implementation.",
    "REJECTED":  "❌ <@{user_id}> Proposal #{id} **{title}** — rejected. {notes}",
    "REVISE":    "📝 <@{user_id}> Proposal #{id} **{title}** — sent back for revision. {notes}",
}


async def echo_decisions_loop():
    """Every 30s: find proposals with a Ross decision but no Discord echo yet,
    post to #ict-bot-alerts tagging the submitter, mark as echoed in DB.

    Best-effort — failures are logged. If the channel is unavailable we just
    retry next tick. Killzone /proposals is the source of truth either way.
    """
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            conn = sqlite3.connect(BOT_DB)
            rows = conn.execute(
                """SELECT id, title, ross_decision, ross_notes, discord_user_id
                   FROM proposals
                   WHERE ross_decision IS NOT NULL
                     AND decision_echoed_at IS NULL
                   ORDER BY id ASC LIMIT 5"""
            ).fetchall()
            conn.close()

            if rows:
                channel = bot.get_channel(ALERTS_CHANNEL_ID)
                if channel is None:
                    logger.warning(f"echo_decisions: channel {ALERTS_CHANNEL_ID} not found, retrying next tick")
                else:
                    for pid, title, decision, notes, user_id in rows:
                        tmpl = DECISION_ECHO_TEMPLATE.get(decision)
                        if not tmpl:
                            continue
                        notes_str = f"\nReason: {notes}" if notes else ""
                        msg_text = tmpl.format(id=pid, title=title, user_id=user_id, notes=notes_str)
                        try:
                            sent = await channel.send(msg_text)
                            now = datetime.now(timezone.utc).isoformat()
                            conn = sqlite3.connect(BOT_DB)
                            conn.execute(
                                "UPDATE proposals SET decision_echoed_at=?, decision_echo_message_id=? WHERE id=?",
                                (now, sent.id, pid),
                            )
                            conn.commit()
                            conn.close()
                            logger.info(f"echo_decisions: posted {decision} for proposal #{pid}")
                        except Exception as e:
                            logger.error(f"echo_decisions: failed to post #{pid}: {e}")
        except Exception as e:
            logger.error(f"echo_decisions loop error: {e}")
        await asyncio.sleep(30)


@bot.event
async def on_ready():
    logger.info(f"Bot connected as {bot.user} (ID: {bot.user.id})")
    for guild in bot.guilds:
        logger.info(f"  Guild: {guild.name} (ID: {guild.id})")
        for channel in guild.text_channels[:5]:
            logger.info(f"    #{channel.name} (ID: {channel.id})")

    # Sync slash commands
    try:
        synced = await bot.tree.sync()
        logger.info(f"Synced {len(synced)} slash commands")
    except Exception as e:
        logger.error(f"Failed to sync commands: {e}")

    # Start the decision echo-back loop once
    if not getattr(bot, "_echo_loop_started", False):
        bot.loop.create_task(echo_decisions_loop())
        bot._echo_loop_started = True
        logger.info("decision echo-back loop started (30s tick)")


@bot.event
async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
    """Track reactions on messages for group performance metrics."""
    emoji = str(payload.emoji)
    if emoji in ("👍", "👎", "❓"):
        try:
            conn = sqlite3.connect(BOT_DB)
            conn.execute(
                "INSERT OR IGNORE INTO reactions (message_id, channel_id, user_id, reaction) VALUES (?, ?, ?, ?)",
                (payload.message_id, payload.channel_id, payload.user_id, emoji),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Reaction tracking failed: {e}")



import base64

async def download_discord_image(url: str) -> str | None:
    """Download a Discord image attachment and return base64 encoded data."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                return base64.b64encode(resp.content).decode("utf-8")
    except Exception as e:
        logger.error(f"Image download failed: {e}")
    return None


async def analyze_image_with_claude(image_b64: str, question: str, trading_ctx: str) -> str:
    """Analyze an image using Anthropic API (claude -p doesn't support images)."""
    # Must use API for vision — claude -p is text-only
    from llm_failover import get_config
    cfg = get_config()
    api_key = cfg.get("anthropic_api_key", "")
    if not api_key:
        return "Image analysis unavailable — no API key configured for vision."

    import httpx
    try:
        body = {
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 1024,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/png", "data": image_b64}
                    },
                    {
                        "type": "text",
                        "text": f"You are Captain Hook, an ICT trading assistant. Analyze this chart image.\n\nContext: {question}\n\nTrading data: {trading_ctx[:500]}\n\nIdentify: timeframe, instrument, ICT patterns visible (FVG, OB, MSS, sweep, BPR, etc.), key levels, and what trade setup if any. Be specific and concise."
                    }
                ]
            }]
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=body,
            )
            if resp.status_code == 200:
                return resp.json()["content"][0]["text"]
            else:
                return f"Image analysis error: {resp.status_code}"
    except Exception as e:
        return f"Image analysis failed: {e}"



import re as _re
import tempfile

async def extract_youtube_transcript(url: str) -> str | None:
    """Extract transcript from YouTube using yt-dlp via create_subprocess_exec (safe, no shell)."""
    match = _re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})', url)
    if not match:
        return None
    video_id = match.group(1)
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            proc = await asyncio.create_subprocess_exec(
                "yt-dlp", "--write-auto-sub", "--sub-lang", "en",
                "--skip-download", "--output", f"{tmpdir}/%(id)s",
                f"https://youtube.com/watch?v={video_id}",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=30)
            import glob
            sub_files = glob.glob(f"{tmpdir}/*.vtt") + glob.glob(f"{tmpdir}/*.srt")
            if not sub_files:
                return None
            raw = open(sub_files[0]).read()
            lines = []
            for line in raw.split("\n"):
                line = line.strip()
                if not line or line.startswith("WEBVTT") or "-->" in line or _re.match(r"^\d+$", line):
                    continue
                line = _re.sub(r"<[^>]+>", "", line)
                if line and line not in lines[-1:]:
                    lines.append(line)
            transcript = " ".join(lines)
            return transcript[:3000] + ("... [truncated]" if len(transcript) > 3000 else "")
    except Exception as e:
        logger.error(f"YouTube transcript failed: {e}")
        return None

def _extract_youtube_url(text: str) -> str | None:
    match = _re.search(r'(https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)[a-zA-Z0-9_-]+[^\s]*)', text)
    return match.group(1) if match else None


# Channels Captain Hook listens in (responds to questions and @mentions)
LISTEN_CHANNELS = {
    1485750310160040036,  # ict-bot-alerts
    1071958694134288477,  # general
}

# Cooldown to prevent spam (seconds between responses in same channel)
_last_response = {}
MESSAGE_COOLDOWN = 10


def _should_respond(message: discord.Message) -> bool:
    """Decide if Captain Hook should respond to this message."""
    # Never respond to self or other bots
    if message.author.bot:
        return False

    # Only in designated channels
    if message.channel.id not in LISTEN_CHANNELS:
        return False

    # Only respond to @mentions or replies to Captain Hook's messages
    if bot.user in message.mentions:
        return True

    if message.reference and message.reference.resolved:
        ref = message.reference.resolved
        if hasattr(ref, "author") and ref.author == bot.user:
            return True

    return False


@bot.event
async def on_message(message: discord.Message):
    """Listen for natural conversation and respond when relevant."""
    if not _should_respond(message):
        return

    # Cooldown check
    import time
    now = time.time()
    last = _last_response.get(message.channel.id, 0)
    if now - last < MESSAGE_COOLDOWN:
        return
    _last_response[message.channel.id] = now

    # Show typing indicator
    async with message.channel.typing():
        try:
            # Build context (same as /ask)
            trading_ctx = _get_trading_context()

            # Check for YouTube links
            yt_url = _extract_youtube_url(message.content or "")
            if yt_url:
                transcript = await extract_youtube_transcript(yt_url)
                if transcript:
                    answer = await llm_call(
                        f"You are Captain Hook, an ICT trading assistant. Analyze this YouTube video transcript.\n\n"
                        f"Video: {yt_url}\nTranscript: {transcript}\n\n"
                        f"1. What ICT concepts are discussed?\n2. How does this relate to our v{__version__} scanner?\n"
                        f"3. Any insights we should add?\n4. Key takeaways\n\nBe concise — bullet points.",
                        model="haiku"
                    )
                else:
                    answer = "Couldn't extract a transcript from that video. It may not have captions."
                if len(answer) > 1900:
                    answer = answer[:1900] + "\n\n*...truncated*"
                await message.reply(answer, mention_author=False)
                return

            # Check for image attachments
            image_attachments = [a for a in message.attachments if a.content_type and a.content_type.startswith("image/")]

            if image_attachments:
                # Download and analyze the image
                img = image_attachments[0]
                img_b64 = await download_discord_image(img.url)
                if img_b64:
                    answer = await analyze_image_with_claude(
                        img_b64,
                        message.content or "Analyze this chart",
                        trading_ctx,
                    )
                else:
                    answer = "Could not download the image. Try uploading again."
            else:
                system_with_data = (
                    get_system_prompt() + "\n\n"
                    "You have access to the group's live trading data:\n\n"
                    f"{trading_ctx}\n\n"
                    "You are responding to a natural message in Discord (not a slash command).\n"
                    "Keep responses concise. If the message isn't really a question for you, "
                    "just react with a relevant emoji instead of responding with text.\n"
                    "Use this data to answer questions about trades, performance, and positions."
                )

                # Use LLM failover
                answer = await llm_call(
                    f"{system_with_data}\n\nMessage from {message.author.display_name}: {message.content}",
                    model="haiku"
                )

            if not answer or answer.startswith("[All LLM"):
                return

            # Truncate for Discord
            if len(answer) > 1900:
                answer = answer[:1900] + "\n\n*...truncated*"

            await message.reply(answer, mention_author=False)
            logger.info(f"Responded to {message.author.display_name} in #{message.channel.name}")

        except Exception as e:
            logger.error(f"Message response failed: {e}")

    # Process commands too (so slash commands still work)
    await bot.process_commands(message)


# ── Slash Commands ────────────────────────────────────────────────────────────

def _get_trading_context() -> str:
    """Pull live trading data to include as context for /ask."""
    ctx_parts = []

    # Open trades
    open_trades = query_trading_db(
        "SELECT symbol, timeframe, direction, entry_price, stop_price, target_price, ts_entry "
        "FROM paper_trades WHERE status='OPEN' ORDER BY ts_entry DESC LIMIT 5"
    )
    if open_trades:
        lines = []
        for t in open_trades:
            lines.append(f"  {t['symbol']} {t['timeframe']} {t['direction']} @ {t['entry_price']} (stop={t['stop_price']}, target={t['target_price']})")
        ctx_parts.append("OPEN PAPER TRADES:\n" + "\n".join(lines))
    else:
        ctx_parts.append("OPEN PAPER TRADES: None currently open.")

    # Recent closed trades
    recent = query_trading_db(
        "SELECT symbol, timeframe, direction, status, entry_price, exit_price "
        "FROM paper_trades WHERE status IN ('WIN','LOSS') ORDER BY ts_exit DESC LIMIT 5"
    )
    if recent:
        lines = []
        for t in recent:
            pnl = ""
            if t.get("exit_price") and t.get("entry_price"):
                diff = (t["exit_price"] - t["entry_price"]) if t["direction"] == "LONG" else (t["entry_price"] - t["exit_price"])
                pnl = f" P&L={diff:+.2f}"
            lines.append(f"  {t['symbol']} {t['timeframe']} {t['direction']} → {t['status']}{pnl}")
        ctx_parts.append("LAST 5 CLOSED TRADES:\n" + "\n".join(lines))

    # Win rate
    stats = query_trading_db(
        "SELECT COUNT(*) as total, "
        "SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as wins, "
        "SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as losses, "
        "ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) / "
        "NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as wr "
        "FROM paper_trades"
    )
    if stats:
        s = stats[0]
        ctx_parts.append(f"OVERALL STATS: {s.get('wr', 0)}% WR | {s.get('wins', 0)}W / {s.get('losses', 0)}L | {s.get('total', 0)} total trades")

    # Last alert (most recent paper trade with full details)
    last_alert = query_trading_db(
        "SELECT id, ts_entry, ts_exit, symbol, timeframe, direction, status, "
        "entry_price, entry_low, entry_high, exit_price, stop_price, target_price, "
        "confidence, pnl_pts, rr_actual, kz_active, notes "
        "FROM paper_trades ORDER BY ts_entry DESC LIMIT 1"
    )
    if last_alert:
        a = last_alert[0]
        alert_lines = [
            f"LAST ALERT (Trade #{a.get('id')}):",
            f"  {a.get('symbol')} {a.get('timeframe')} {a.get('direction')} | {a.get('status')} | {a.get('confidence')}% confidence",
            f"  Entry: {a.get('entry_price')} (zone: {a.get('entry_low')}-{a.get('entry_high')})",
            f"  Stop: {a.get('stop_price')} | Target: {a.get('target_price')}",
            f"  Exit: {a.get('exit_price')} | P&L: {a.get('pnl_pts')} pts | R:R: {a.get('rr_actual')}",
            f"  KZ active: {a.get('kz_active')} | Notes: {a.get('notes')}",
            f"  Opened: {str(a.get('ts_entry',''))[:19]} | Closed: {str(a.get('ts_exit',''))[:19]}",
        ]
        ctx_parts.append("\n".join(alert_lines))

    # Today's signal count
    today_signals = query_trading_db(
        "SELECT COUNT(*) as total, "
        "SUM(CASE WHEN signal='ALERT' THEN 1 ELSE 0 END) as alerts "
        "FROM signals WHERE ts > date('now', 'start of day')"
    )
    if today_signals:
        s = today_signals[0]
        ctx_parts.append(f"TODAY: {s.get('total', 0)} scans | {s.get('alerts', 0)} ALERTs fired")

    return "\n\n".join(ctx_parts)


@bot.tree.command(name="ask", description="Ask an ICT trading question — answered by Claude AI")
@app_commands.describe(question="Your ICT/trading question")
async def ask_command(interaction: discord.Interaction, question: str):
    await interaction.response.defer(thinking=True)

    try:
        # Build context-aware system prompt
        trading_ctx = _get_trading_context()
        system_with_data = (
            get_system_prompt() + "\n\n"
            "You have access to the group's live trading data. Here is the current state:\n\n"
            f"{trading_ctx}\n\n"
            "Use this data to answer questions about open trades, performance, and positions. "
            "If asked about trades, positions, win rate, or P&L, reference this data directly."
        )

        # Use failover system (claude-cli -> anthropic-api -> openai-api)
        answer = await llm_call(f"{system_with_data}\n\nUser question: {question}", model="haiku")

        # Truncate for Discord (2000 char limit)
        if len(answer) > 1900:
            answer = answer[:1900] + "\n\n*...truncated*"

        embed = discord.Embed(
            title="ICT Assistant",
            description=answer,
            color=0x00c851,
        )
        embed.set_footer(text=f"Asked by {interaction.user.display_name} | Model: {MODEL}")
        await interaction.followup.send(embed=embed)

    except Exception as e:
        await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)


@bot.tree.command(name="stats", description="Show current paper trading statistics")
async def stats_command(interaction: discord.Interaction):
    await interaction.response.defer(thinking=True)

    # Query trading DB
    summary = query_trading_db("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as losses,
            SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END) as open_trades,
            ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as win_rate
        FROM paper_trades
    """)

    by_symbol = query_trading_db("""
        SELECT symbol,
            ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as wr,
            SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as w,
            SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as l
        FROM paper_trades WHERE status IN ('WIN','LOSS') GROUP BY symbol
    """)

    by_tf = query_trading_db("""
        SELECT timeframe,
            ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as wr,
            SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as w,
            SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as l
        FROM paper_trades WHERE status IN ('WIN','LOSS') GROUP BY timeframe
    """)

    open_trades = query_trading_db("""
        SELECT symbol, timeframe, direction, entry_price, stop_price, target_price, ts_entry
        FROM paper_trades WHERE status='OPEN' ORDER BY ts_entry DESC LIMIT 5
    """)

    if not summary:
        await interaction.followup.send("Could not connect to trading database.", ephemeral=True)
        return

    s = summary[0]
    embed = discord.Embed(
        title="ICT Scanner — Paper Trading Stats",
        color=0x00c851 if (s.get("win_rate") or 0) >= 60 else 0xffbb33,
    )

    embed.add_field(
        name="Overall",
        value=f"**{s['win_rate']}% WR** | {s['wins']}W / {s['losses']}L | {s['total']} total | {s['open_trades']} open",
        inline=False,
    )

    if by_symbol:
        sym_text = "\n".join([f"**{r['symbol']}**: {r['wr']}% ({r['w']}W/{r['l']}L)" for r in by_symbol])
        embed.add_field(name="By Symbol", value=sym_text, inline=True)

    if by_tf:
        tf_text = "\n".join([f"**{r['timeframe']}**: {r['wr']}% ({r['w']}W/{r['l']}L)" for r in by_tf])
        embed.add_field(name="By Timeframe", value=tf_text, inline=True)

    if open_trades:
        op_text = "\n".join([
            f"**{t['symbol']}** {t['timeframe']} {t['direction']} @ {t['entry_price']}"
            for t in open_trades
        ])
        embed.add_field(name="Open Trades", value=op_text, inline=False)

    embed.set_footer(text=f"Scanner v{__version__} | Forward test data from {datetime.now(timezone.utc).strftime('%Y-%m-%d')}")
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="signal", description="Show the latest ICT scanner signal")
async def signal_command(interaction: discord.Interaction):
    await interaction.response.defer(thinking=True)

    signals = query_trading_db("""
        SELECT ts, symbol, timeframe, direction, signal, confidence, conditions, price
        FROM signals ORDER BY ts DESC LIMIT 3
    """)

    if not signals:
        await interaction.followup.send("No recent signals found in the database.", ephemeral=True)
        return

    embed = discord.Embed(title="Latest ICT Signals", color=0x3498db)
    for sig in signals:
        status_icon = "🟢" if sig.get("signal") == "ALERT" else "⚪"
        embed.add_field(
            name=f"{status_icon} {sig['symbol']} {sig['timeframe']} — {sig.get('signal', 'HOLD')}",
            value=(
                f"Direction: {sig.get('direction', 'N/A')} | "
                f"Confidence: {sig.get('confidence', 'N/A')}% | "
                f"Price: {sig.get('price', 'N/A')}\n"
                f"_{sig.get('ts', '')[:16]}_"
            ),
            inline=False,
        )

    embed.set_footer(text=f"ICT Scanner v{__version__} — signals are alerts only, not trade advice")
    await interaction.followup.send(embed=embed)


PROPOSAL_ASSESSMENT_SYSTEM = """You are Captain Hook's silent reviewer. A user submitted a proposal to change the ICT trading scanner. Assess it for Ross.

## Context: what our scanner does

ICT Scanner. Watches ES=F and NQ=F futures only.
Five conditions per signal (need 4/5 to alert):
  1. HTF liquidity sweep (PDH/PDL)
  2. MSS confirmed (CHoCH after sweep)
  3. Recent unmitigated FVG (within 21 candles)
  4. Price within 0.3% of FVG
  5. Kill zone active (London or NY)
Hard gates: HTF bias alignment, position cap (max 1/TF/instrument, max 2/instrument), daily loss halt.
Reference levels surfaced in alerts: PDH/PDL, CBDR, ORG, VIB, BPR, REH/REL, NWOG, HTF bias, macro times.
Paper trades only currently; live coming with Tradovate this week.
Members are non-developers — "easy" changes are rarely easy.

## Your job: 5-step assessment

1. ICT validity — is this real ICT methodology or a misunderstanding?
2. Scanner code impact — small tweak vs new subsystem? Any prerequisites missing?
3. Data evidence — would we need backtest data to validate?
4. Dependencies — does this conflict or compose with other recent proposals?
5. Recommendation — APPROVE (ship as-is), REJECT (bad idea, explain why), or MODIFY (good direction, but ship in phases / change scope).

Bias: prefer phasing risky additions (data-collection first, logic later). Reject things that override safety gates without validation. Approve cleanly-scoped additions to existing patterns.

## Output format — STRICT JSON, no markdown fences, no prose outside JSON

{
  "recommendation": "APPROVE" | "REJECT" | "MODIFY",
  "reasoning": "your full markdown analysis (the 5 steps), 200-800 words"
}
"""


async def assess_proposal_background(proposal_id: int, title: str, description: str):
    """Run Claude over the new proposal, write recommendation back to bot.db.
    Best-effort: failures are logged, never raised — Ross can re-trigger or
    write the assessment manually via the /assess endpoint."""
    try:
        prompt = f"## Proposal #{proposal_id}\n\n**Title:** {title}\n\n**Body:**\n{description}\n\nReturn the JSON object now."
        raw = await llm_call(prompt=prompt, system_prompt=PROPOSAL_ASSESSMENT_SYSTEM, model="sonnet")
        # Strip optional code fences if Claude includes them despite instructions
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```", 2)[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.rsplit("```", 1)[0].strip()
        import json as _json
        data = _json.loads(cleaned)
        rec = data["recommendation"]
        reasoning = data["reasoning"]
        if rec not in ("APPROVE", "REJECT", "MODIFY"):
            raise ValueError(f"invalid recommendation: {rec!r}")

        now = datetime.now(timezone.utc).isoformat()
        conn = sqlite3.connect(BOT_DB)
        conn.execute(
            "UPDATE proposals SET claude_recommendation=?, claude_reasoning=?, claude_assessed_at=? WHERE id=?",
            (rec, reasoning, now, proposal_id),
        )
        conn.commit()
        conn.close()
        logger.info(f"Proposal #{proposal_id} auto-assessed: {rec}")
    except Exception as e:
        logger.error(f"Proposal #{proposal_id} auto-assessment failed: {e}")


@bot.tree.command(name="propose", description="Propose a strategy change (requires Ross's approval)")
@app_commands.describe(
    title="Short title for the proposal",
    description="Detailed description of what you want to change and why",
)
async def propose_command(interaction: discord.Interaction, title: str, description: str):
    await interaction.response.defer(thinking=True)

    # Save proposal to DB
    conn = sqlite3.connect(BOT_DB)
    cursor = conn.execute(
        "INSERT INTO proposals (discord_user, discord_user_id, title, description) VALUES (?, ?, ?, ?)",
        (interaction.user.display_name, interaction.user.id, title, description),
    )
    proposal_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # Kick off Claude's pre-assessment in the background — doesn't block the reply
    asyncio.create_task(assess_proposal_background(proposal_id, title, description))

    # Send to Ross via Telegram
    telegram_msg = (
        f"📋 <b>New Proposal #{proposal_id}</b>\n\n"
        f"<b>From:</b> {interaction.user.display_name} (Discord)\n"
        f"<b>Title:</b> {title}\n"
        f"<b>Description:</b> {description}\n\n"
        f"Pre-assessment running. Review at:\n"
        f"https://dashboard.ictwealthbuilding.com/proposals"
    )
    msg_id = await send_telegram(telegram_msg)

    if msg_id:
        conn = sqlite3.connect(BOT_DB)
        conn.execute("UPDATE proposals SET telegram_msg_id=? WHERE id=?", (msg_id, proposal_id))
        conn.commit()
        conn.close()

    embed = discord.Embed(
        title=f"Proposal #{proposal_id} Submitted",
        description=f"**{title}**\n\n{description}",
        color=0xffbb33,
    )
    embed.set_footer(text=f"By {interaction.user.display_name} | Pending Ross's approval")
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="research", description="Search the web for trading topics")
@app_commands.describe(query="What to search for (trading strategies, tools, concepts)")
async def research_command(interaction: discord.Interaction, query: str):
    await interaction.response.defer(thinking=True)

    results = brave_search(f"algorithmic trading {query}", count=5)

    if not results:
        await interaction.followup.send("Search returned no results.", ephemeral=True)
        return

    embed = discord.Embed(
        title=f"Research: {query}",
        color=0x3498db,
    )

    for r in results[:5]:
        import re
        desc = re.sub(r"<[^>]+>", "", r.get("desc", ""))[:200]
        embed.add_field(
            name=r.get("title", "Untitled")[:256],
            value=f"{desc}\n[Link]({r['url']})" if r.get("url") else desc,
            inline=False,
        )

    embed.set_footer(text=f"Searched by {interaction.user.display_name} | Brave Search API")
    await interaction.followup.send(embed=embed)



@bot.tree.command(name="glossary", description="ICT trading terminology glossary")
async def glossary_command(interaction: discord.Interaction):
    embed = discord.Embed(
        title="ICT Glossary",
        description="Common ICT and trading acronyms used in this group.",
        color=0x3498db,
    )
    embed.add_field(
        name="Market Structure",
        value=(
            "**MSS** — Market Structure Shift (confirmed trend change)\n"
            "**CHoCH** — Change of Character (first sign of reversal)\n"
            "**BOS** — Break of Structure (trend continuation)\n"
            "**PO3** — Power of Three (Accumulation, Manipulation, Distribution)\n"
            "**AMD** — Accumulation, Manipulation, Distribution"
        ),
        inline=False,
    )
    embed.add_field(
        name="Liquidity & Zones",
        value=(
            "**BSL** — Buy Side Liquidity (stops above swing highs)\n"
            "**SSL** — Sell Side Liquidity (stops below swing lows)\n"
            "**REH** — Relative Equal Highs (clustered liquidity pool)\n"
            "**REL** — Relative Equal Lows (clustered liquidity pool)\n"
            "**OB** — Order Block (institutional entry zone)\n"
            "**FVG** — Fair Value Gap (3-candle price imbalance)\n"
            "**CE** — Consequent Encroachment (50% of FVG)\n"
            "**BPR** — Balance Price Range (overlapping bull+bear FVGs)\n"
            "**VIB** — Volume Imbalance (body-to-body gap)\n"
            "**NWOG** — New Weekly Opening Gap (Fri close to Sun open)"
        ),
        inline=False,
    )
    embed.add_field(
        name="Entry & Targets",
        value=(
            "**OTE** — Optimal Trade Entry (62-79% fib retracement)\n"
            "**R:R** — Risk to Reward ratio\n"
            "**T1/T2/T3** — Target levels (-0.5, -1.0, -2.0 fib extensions)"
        ),
        inline=False,
    )
    embed.add_field(
        name="Sessions & Timing",
        value=(
            "**KZ** — Kill Zone (high-probability trading window)\n"
            "**NY AM** — New York AM session (7-10 AM NY)\n"
            "**NY PM** — New York PM session (1:30-4 PM NY)\n"
            "**HTF** — Higher Time Frame\n"
            "**LTF** — Lower Time Frame"
        ),
        inline=False,
    )
    embed.add_field(
        name="Technical",
        value=(
            "**ATR** — Average True Range (volatility measure)\n"
            "**SMA** — Simple Moving Average\n"
            "**IFVG** — Inversion Fair Value Gap (invalidated FVG flipped)"
        ),
        inline=False,
    )
    embed.set_footer(text=f"Captain Hook v{__version__} — /glossary | Proposal by Shift")
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="health", description="Check system health — VPS, endpoints, scheduler")
async def health_command(interaction: discord.Interaction):
    await interaction.response.defer(thinking=True)

    import httpx

    checks = {}
    async with httpx.AsyncClient(timeout=10) as client:
        # Check endpoints
        for name, url in [
            ("Webhook", "https://webhook.ictwealthbuilding.com/health"),
            ("Dashboard", "https://dashboard.ictwealthbuilding.com"),
        ]:
            try:
                resp = await client.get(url)
                checks[name] = f"✅ {resp.status_code}"
            except Exception as e:
                checks[name] = f"❌ {str(e)[:50]}"

        # Check RoceOS scheduler
        try:
            resp = await client.get("http://localhost:8000/scheduler/status")
            sched = resp.json()
            checks["Scheduler"] = f"✅ {sched.get('jobs_registered', '?')} jobs, {sched.get('recent_runs', {}).get('total', 0)} runs"
        except Exception:
            checks["Scheduler"] = "❌ Unreachable"

    embed = discord.Embed(title="System Health", color=0x00c851 if "❌" not in str(checks) else 0xe74c3c)
    for name, status in checks.items():
        embed.add_field(name=name, value=status, inline=True)

    embed.set_footer(text=f"Checked at {datetime.now(timezone.utc).strftime('%H:%M UTC')}")
    await interaction.followup.send(embed=embed)


# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    logger.info(f"Starting Captain Hook v{__version__}...")
    bot.run(DISCORD_TOKEN)
