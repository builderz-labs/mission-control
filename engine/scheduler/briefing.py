"""RoceOS Morning Briefing — Phase 6 Step 4.

Two-phase briefing:
1. Parallel data collection (6:50 AM) — gather from sources with timeouts
2. Synthesis (7:00 AM) — general skillset combines into one coherent message

Graceful degradation: if any source fails, briefing still sends with available data.

System health is collected via direct HTTP to /api/health/detailed (the canonical
self-heal endpoint), NOT via LLM with shell tools. The previous LLM-based path
hallucinated tool-call XML markup into Telegram and ran docker/systemctl checks
inside the container's sandbox where they don't exist.
"""
import asyncio
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from scheduler.core import run_skillset_prompt, log_run, JobResult
from scheduler.notification import NotifyLevel

logger = logging.getLogger("roceos.scheduler.briefing")

CDT = ZoneInfo("America/Chicago")

# Per-source timeout (seconds)
SOURCE_TIMEOUT = 60

HEALTH_ENDPOINT = "https://api.ictwealthbuilding.com/api/health/detailed"

# Strip Claude tool-use markup that the engine's LLM layer sometimes emits
# verbatim when allowedTools were set but the tool runtime didn't execute them.
# Belt-and-suspenders: synthesis prompt also asks for stripping, but we sanitize
# the raw collection results too so it can't leak through.
_TOOL_USE_RE = re.compile(
    r"<\s*(function_calls|invoke|parameter)\b[^>]*>.*?<\s*/\s*\1\s*>",
    re.DOTALL | re.IGNORECASE,
)


def _strip_tool_use_markup(text: str) -> str:
    """Remove <function_calls>/<invoke>/<parameter> blocks the model may have
    generated as text instead of as actual tool invocations."""
    if not text:
        return text
    cleaned = _TOOL_USE_RE.sub("", text)
    # Also strip leftover open/close tags if any survived
    cleaned = re.sub(r"<\s*/?\s*(function_calls|invoke|parameter)\b[^>]*>", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


async def _collect_system_health() -> dict:
    """Collect system health via /api/health/detailed — no LLM, no shell tools.

    The endpoint is fed by /opt/scripts/system_health.sh which runs hourly,
    checks every subsystem, attempts safe self-heal, and writes JSON. We just
    format whichever state it reports. If the endpoint itself is unreachable
    that's its own kind of red flag — surface it.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(HEALTH_ENDPOINT)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        return {
            "name": "system",
            "status": "error",
            "data": f"⚠️ System health endpoint unreachable: {str(e)[:100]}. Check ict-dashboard-api.",
        }

    overall = data.get("overall", "unknown")
    if overall == "green":
        return {"name": "system", "status": "ok", "data": "✅ All systems green"}

    if overall == "healed":
        healed = ", ".join(data.get("healed", [])) or "(none listed)"
        return {
            "name": "system",
            "status": "ok",
            "data": f"✅ Healthy — auto-fixed: {healed}",
        }

    # red — surface action items only (skip green/healed details to keep brief)
    items = data.get("action_items", [])
    if not items:
        return {"name": "system", "status": "ok", "data": f"⚠️ overall={overall} but no action items reported"}
    lines = [f"⚠️ {a['name']}: {a.get('action_item', '(no detail)')}" for a in items]
    return {"name": "system", "status": "ok", "data": "\n".join(lines)}


async def _collect_source(name: str, skillset: str, prompt: str) -> dict:
    """Collect data from a single source with timeout."""
    try:
        result = await run_skillset_prompt(
            job_id=f"briefing_collect_{name}",
            skillset=skillset,
            prompt=prompt,
            timeout_seconds=SOURCE_TIMEOUT,
        )
        if result.status == "ok" and result.output and result.output.strip().upper() != "NO_REPLY":
            cleaned = _strip_tool_use_markup(result.output)
            return {"name": name, "status": "ok", "data": cleaned}
        return {"name": name, "status": "empty", "data": ""}
    except Exception as e:
        logger.error(f"Briefing source {name} failed: {e}")
        return {"name": name, "status": "error", "data": f"(unavailable: {str(e)[:50]})"}


async def collect_briefing_data() -> list[dict]:
    """Collect data from all sources in parallel."""
    now = datetime.now(CDT)
    day_name = now.strftime("%A")
    date_str = now.strftime("%B %d, %Y")
    is_weekday = now.weekday() < 5

    # System health is collected directly from /api/health/detailed (run in
    # parallel below with the LLM-driven sources). Removed the it_ops LLM
    # source — see module docstring for why.
    sources = [
        (
            "calendar",
            "general",
            f"Today is {day_name}, {date_str}. Check ALL 4 Google Calendars for today's events. "
            "List each event with time (CDT) and calendar source, sorted chronologically. "
            "If no events, say 'No events today.' Keep it brief — just the list."
        ),
        (
            "weather",
            "general",
            "Get the current weather and today's forecast for Huntsville, AL. "
            "Include: current temp, conditions, high/low, any weather alerts. "
            "2-3 lines max."
        ),
    ]

    # Add trading source on weekdays
    if is_weekday:
        sources.append((
            "trading",
            "trading",
            "Quick pre-market trading status. Check: "
            "1. Any paper trades currently open (symbol, direction, P&L) "
            "2. Any signals that fired overnight "
            "3. Key economic events today that could affect ES/NQ "
            "Be brief — 3-5 bullet points max. If nothing notable, say so in one line."
        ))

    # Run LLM sources in parallel alongside the direct system-health fetch.
    tasks = [_collect_source(name, skill, prompt) for name, skill, prompt in sources]
    tasks.append(_collect_system_health())
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Handle any exceptions from gather
    collected = []
    for r in results:
        if isinstance(r, Exception):
            collected.append({"name": "unknown", "status": "error", "data": str(r)[:100]})
        else:
            collected.append(r)

    return collected


async def synthesize_briefing(collected_data: list[dict], router=None) -> JobResult:
    """Synthesize collected data into a single morning briefing message."""
    now = datetime.now(CDT)
    day_name = now.strftime("%A")
    date_str = now.strftime("%B %d, %Y")

    # Build the synthesis prompt with available data
    sections = []
    failed_sources = []

    for source in collected_data:
        if source["status"] == "ok" and source["data"]:
            sections.append(f"### {source['name'].upper()}\n{source['data']}")
        else:
            failed_sources.append(source["name"])

    if not sections:
        # Everything failed
        result = JobResult(
            job_id="morning_briefing",
            skillset="general",
            status="error",
            error="All briefing data sources failed",
            notify_level=NotifyLevel.CRITICAL.value,
        )
        log_run(result)
        if router:
            await router.route(
                "morning_briefing", NotifyLevel.CRITICAL,
                f"⚠️ Morning briefing failed — all data sources timed out or errored. Check engine logs."
            )
        return result

    data_block = "\n\n".join(sections)
    failed_note = ""
    if failed_sources:
        failed_note = f"\n\nNote: These sources were unavailable: {', '.join(failed_sources)}. Proceed without them."

    synthesis_prompt = (
        f"It's {day_name}, {date_str}. Synthesize this data into Ross's morning briefing.\n\n"
        f"Raw data from automated collection:\n\n{data_block}{failed_note}\n\n"
        "FORMAT RULES:\n"
        "- Plain text for Telegram. NO markdown tables.\n"
        "- Lead with the most time-sensitive item\n"
        "- Bullet points, not paragraphs\n"
        "- Calendar events: sorted by time with CDT\n"
        "- Weather: one line\n"
        "- Trading: only if noteworthy\n"
        "- System: only if issues — if SYSTEM section already says 'All systems green' or starts with ✅, omit a System section entirely\n"
        "- Keep total under 300 words\n"
        "- No greetings or sign-offs — just the briefing content\n"
        "- CRITICAL: never include any <function_calls>, <invoke>, or <parameter> tags in your response. "
        "If the raw data contains those, treat them as garbage and discard. Output is plain prose for a phone screen."
    )

    result = await run_skillset_prompt(
        job_id="morning_briefing",
        skillset="general",
        prompt=synthesis_prompt,
        timeout_seconds=120,
    )

    result.notify_level = NotifyLevel.BRIEFING.value
    log_run(result)

    if router:
        msg = result.output or "Morning briefing synthesis failed. Check engine logs."
        if result.status == "error":
            msg = f"⚠️ Morning briefing error: {result.error}"
        # Final guard — strip any tool-use markup that survived the prompt
        msg = _strip_tool_use_markup(msg)
        await router.route("morning_briefing", NotifyLevel.BRIEFING, msg)

    return result


async def run_morning_briefing(router=None):
    """Full morning briefing: collect + synthesize + deliver."""
    logger.info("Starting morning briefing collection...")
    data = await collect_briefing_data()

    ok_count = sum(1 for d in data if d["status"] == "ok")
    logger.info(f"Briefing collection complete: {ok_count}/{len(data)} sources OK")

    logger.info("Starting briefing synthesis...")
    result = await synthesize_briefing(data, router=router)
    logger.info(f"Briefing complete: status={result.status}, {len(result.output or '')} chars")

    return result
