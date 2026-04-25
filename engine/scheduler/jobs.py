"""RoceOS Scheduled Jobs — Phase 6 Steps 3-6.

Each job is an async function that:
1. Calls run_skillset_prompt() with a specific prompt and skillset
2. Routes the output through the NotificationRouter
3. Logs the result
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler.core import (
    run_skillset_prompt, log_run, register_job,
    get_consecutive_failures, JobResult,
)
from scheduler.notification import NotifyLevel

logger = logging.getLogger("roceos.scheduler.jobs")

CDT = ZoneInfo("America/Chicago")

# Will be set during registration
_router = None


def set_router(router):
    global _router
    _router = router


# ── Job: IT Ops Health Check ─────────────────────────────────────────────────

async def it_ops_health_check():
    """Every 30 min — check VPS, containers, endpoints. Silent unless broken."""
    job_id = "it_ops_health_check"

    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="it_ops",
        prompt=(
            "Run a quick health check using these commands:\n"
            "1. curl -s http://172.17.0.1:8080/api/health (checks DB, webhook, engine)\n"
            "2. df -h / (disk usage)\n"
            "3. free -m (memory)\n\n"
            "IMPORTANT: You are inside Docker. Do NOT run docker commands — they will fail.\n"
            "Use the API health endpoint above instead.\n\n"
            "KNOWN ISSUES (do NOT report):\n"
            "- pulse.ictwealthbuilding.com returns 404 (deprecated, expected)\n\n"
            "If /api/health shows status=ok and disk/memory are normal, respond with exactly NO_REPLY.\n"
            "Only report if something is actually broken."
        ),
        timeout_seconds=90,
    )

    # Cascade detection — 3 consecutive failures = escalate
    if result.status == "error":
        failures = get_consecutive_failures(job_id)
        if failures >= 2:
            result.notify_level = NotifyLevel.CRITICAL.value
            result.output = f"⚠️ IT OPS: {failures + 1} consecutive health check failures.\nLatest: {result.error}"

    level = NotifyLevel.SILENT if result.status in ("ok", "no_reply") else NotifyLevel.CRITICAL
    if result.status == "ok" and result.output:
        level = NotifyLevel.CONDITIONAL

    result.notify_level = level.value
    log_run(result)

    if _router and result.output:
        await _router.route(job_id, level, result.output)


# ── Job: Trading Market Close Summary ────────────────────────────────────────

async def trading_market_close_summary():
    """4 PM CDT weekdays — daily trading summary."""
    job_id = "trading_market_close_summary"

    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="trading",
        prompt=(
            "Generate the end-of-day trading summary. Include:\n"
            "1. Any paper trades opened or closed today (from the trading database)\n"
            "2. Current open positions and unrealized P&L\n"
            "3. Today's signals (how many fired, how many were ALERT vs HOLD)\n"
            "4. Running win rate and total paper P&L\n"
            "5. Any notable market moves in ES/NQ today\n\n"
            "Keep it concise — bullet points, no tables. "
            "If no trading activity today, say so briefly (don't say NO_REPLY)."
        ),
        timeout_seconds=120,
    )

    result.notify_level = NotifyLevel.BRIEFING.value
    log_run(result)

    if _router:
        await _router.route(job_id, NotifyLevel.BRIEFING, result.output or "Trading summary unavailable.")


# ── Job: Morning Briefing (delegates to briefing.py) ─────────────────────────

async def morning_briefing():
    """7 AM CDT daily — aggregated briefing across all domains."""
    from scheduler.briefing import run_morning_briefing
    await run_morning_briefing(router=_router)


# ── Job: Calendar Watch (delegates to calendar_watch.py) ─────────────────────

async def calendar_watch():
    """Every 30 min — poll calendars for upcoming events, trigger prep/reminders."""
    from scheduler.calendar_watch import calendar_watch as _cw
    await _cw(router=_router)


# ── Job: Trading Weekend Review ──────────────────────────────────────────────

async def trading_weekend_review():
    """Saturday 10 AM CDT — weekly trading performance analysis."""
    job_id = "trading_weekend_review"

    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="trading",
        prompt=(
            "Generate the weekly trading review. Analyze:\n"
            "1. This week's paper trades: total count, wins, losses, win rate\n"
            "2. Best and worst trades (symbol, direction, P&L)\n"
            "3. Which timeframes performed best (15m vs 1h)\n"
            "4. ES vs NQ performance comparison\n"
            "5. Are we on track for the forward test goals?\n"
            "6. Any patterns in the losses — what can we learn?\n"
            "7. Recommendation: should we adjust anything for next week?\n\n"
            "Be analytical and honest. This is for strategy improvement."
        ),
        timeout_seconds=180,
    )

    result.notify_level = NotifyLevel.BRIEFING.value
    log_run(result)

    if _router:
        await _router.route(job_id, NotifyLevel.BRIEFING, result.output or "Weekend review unavailable.")


# ── Job: Security Weekly Threat Scan ─────────────────────────────────────────

async def security_weekly_threat_scan():
    """Monday 8 AM CDT — weekly security landscape check."""
    job_id = "security_weekly_threat_scan"

    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="security",
        prompt=(
            "Weekly security check:\n"
            "1. Check VPS for any unauthorized access attempts (auth.log last 7 days)\n"
            "2. Check for any failed SSH login attempts\n"
            "3. Are all exposed services using current TLS?\n"
            "4. Any Docker images with known vulnerabilities?\n"
            "5. Is the Cloudflare tunnel configuration secure?\n\n"
            "If nothing concerning, respond with NO_REPLY.\n"
            "If any issues found, report with severity and recommended action."
        ),
        timeout_seconds=120,
    )

    level = NotifyLevel.SILENT if result.status == "no_reply" else NotifyLevel.CONDITIONAL
    result.notify_level = level.value
    log_run(result)

    if _router and result.output:
        await _router.route(job_id, level, result.output)


# ── Job: CTO GitHub Digest ───────────────────────────────────────────────────

async def cto_github_digest():
    """Friday 5 PM CDT — weekly GitHub activity summary."""
    job_id = "cto_github_digest"

    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="cto",
        prompt=(
            "Generate the weekly GitHub digest for spaceghostroce repos.\n"
            "Check:\n"
            "1. Commits this week across all repos (trading-system, roce-os, etc.)\n"
            "2. Any open PRs or issues\n"
            "3. Any branches that should be cleaned up\n"
            "4. Notable changes or milestones\n\n"
            "Keep it brief. If minimal activity, say so in 1-2 lines (don't say NO_REPLY)."
        ),
        timeout_seconds=120,
    )

    result.notify_level = NotifyLevel.BRIEFING.value
    log_run(result)

    if _router:
        await _router.route(job_id, NotifyLevel.BRIEFING, result.output or "GitHub digest unavailable.")



# ── Job: Signal Quality Monitor ──────────────────────────────────────────────

async def signal_quality_monitor():
    """Every 6 hours during weekdays — check if scanner is producing signals."""
    job_id = "signal_quality_monitor"

    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="trading",
        prompt=(
            "Check the trading signal database. How many ALERT signals have fired "
            "in the last 24 hours across all instruments and timeframes? "
            "Also check: how many total scans ran? What percentage were ALERT vs HOLD?\n\n"
            "If zero ALERTs in 24 hours during market days, that is concerning — flag it.\n"
            "If ALERTs are firing normally, respond with NO_REPLY.\n"
            "If zero ALERTs, explain what conditions are failing (which of the 5 conditions "
            "is the bottleneck?) and recommend whether any parameters need adjustment."
        ),
        timeout_seconds=90,
    )

    level = NotifyLevel.SILENT if result.status == "no_reply" else NotifyLevel.CONDITIONAL
    result.notify_level = level.value
    log_run(result)

    if _router and result.output:
        await _router.route(job_id, level, result.output)



# ── Job: Weekly Trading Research Scan ─────────────────────────────────────────

async def weekly_trading_research():
    """Sunday 8 PM CDT — deep web scan for new trading strategies, tools, and methods."""
    job_id = "weekly_trading_research"

    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="trading",
        prompt=(
            "Run a weekly trading research scan. Search the web for:\n"
            "1. New algorithmic trading strategies published this week\n"
            "2. New open-source trading tools or library releases\n"
            "3. Reddit r/algotrading top posts this week — any actionable insights?\n"
            "4. New ICT or smart money concepts content\n"
            "5. Alpaca API updates or new features\n"
            "6. Any new backtesting results for ORB, mean reversion, or momentum strategies\n\n"
            "For each finding, provide: title, source, and 1-2 sentences on why it matters "
            "for our ES/NQ futures scanning system.\n\n"
            "If nothing notable this week, give a brief summary of the landscape. "
            "Do not say NO_REPLY — always provide at least a brief market of ideas."
        ),
        timeout_seconds=180,
    )

    result.notify_level = NotifyLevel.BRIEFING.value
    log_run(result)

    if _router:
        await _router.route(job_id, NotifyLevel.BRIEFING, result.output or "Research scan unavailable.")

# ── Registration ─────────────────────────────────────────────────────────────

def register_all_jobs(router):
    """Register all scheduled jobs with the scheduler."""
    set_router(router)

    # Initialize calendar trigger database
    from scheduler.calendar_watch import init_trigger_db
    from config import settings
    init_trigger_db(settings.scheduler_db_path.replace(".db", "_triggers.db"))

    # ── Every 30 minutes ──
    register_job("it_ops_health_check", it_ops_health_check, "*/30 * * * *")
    register_job("calendar_watch", calendar_watch, "*/30 * * * *")

    # ── Daily ──
    register_job("morning_briefing", morning_briefing, "0 7 * * *")

    # ── Weekdays ──
    register_job("trading_market_close_summary", trading_market_close_summary, "0 16 * * 1-5")

    # ── Weekly ──
    register_job("trading_weekend_review", trading_weekend_review, "0 10 * * 6")  # Sat 10 AM
    register_job("security_weekly_threat_scan", security_weekly_threat_scan, "0 8 * * 1")  # Mon 8 AM
    register_job("cto_github_digest", cto_github_digest, "0 17 * * 5")  # Fri 5 PM

    # Signal quality monitor — 3x daily during weekdays
    register_job("signal_quality_monitor", signal_quality_monitor, "0 10,16,22 * * 1-5")

    # Weekly trading research — Sunday 8 PM CDT
    register_job("weekly_trading_research", weekly_trading_research, "0 20 * * 0")

    logger.info("All Phase 6 jobs registered")
