"""RoceOS Calendar Watch — Phase 6 Step 5.

Polls Google Calendar every 30 minutes. Triggers:
- TTRPG session prep: 24h before any event on mon-ttrpgs calendar
- Event reminder: 2h before any event on any calendar

Uses SQLite deduplication to prevent double-firing.
"""
import logging
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from scheduler.core import run_skillset_prompt, log_run
from scheduler.notification import NotifyLevel

logger = logging.getLogger("roceos.scheduler.calendar")

CDT = ZoneInfo("America/Chicago")

# Calendar IDs
TTRPG_CALENDAR = "aab9c30892c45e74413e9a549fff4ac57af5f7c11ee13a8158abb412111b84b5@group.calendar.google.com"
ALL_CALENDARS = [
    "roce.hickey@gmail.com",
    "sqe2bl9dr18osdjd08mpdb9qug@group.calendar.google.com",  # LoHickey Fam
    TTRPG_CALENDAR,  # mon-ttrpgs
    "family00304722653063627796@group.calendar.google.com",  # Family
]

_db_path: str = ""


def init_trigger_db(db_path: str):
    """Initialize the trigger deduplication database."""
    global _db_path
    _db_path = db_path
    conn = sqlite3.connect(db_path, timeout=10)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS calendar_triggers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            fired_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(event_id, trigger_type)
        )
    """)
    conn.commit()
    conn.close()


def already_triggered(event_id: str, trigger_type: str) -> bool:
    """Check if this event+trigger combo has already fired."""
    if not _db_path:
        return False
    conn = sqlite3.connect(_db_path, timeout=10)
    row = conn.execute(
        "SELECT 1 FROM calendar_triggers WHERE event_id=? AND trigger_type=?",
        (event_id, trigger_type)
    ).fetchone()
    conn.close()
    return row is not None


def mark_triggered(event_id: str, trigger_type: str):
    """Mark this event+trigger as fired."""
    if not _db_path:
        return
    try:
        conn = sqlite3.connect(_db_path, timeout=10)
        conn.execute(
            "INSERT OR IGNORE INTO calendar_triggers (event_id, trigger_type) VALUES (?, ?)",
            (event_id, trigger_type)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to mark trigger: {e}")


def cleanup_old_triggers(days: int = 30):
    """Remove triggers older than N days."""
    if not _db_path:
        return
    try:
        conn = sqlite3.connect(_db_path, timeout=10)
        conn.execute(
            "DELETE FROM calendar_triggers WHERE fired_at < datetime('now', ?)",
            (f"-{days} days",)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to cleanup triggers: {e}")


async def calendar_watch(router=None):
    """Poll calendars and fire triggers based on upcoming events.

    This job runs every 30 minutes. It asks the general skillset to check
    calendars and returns structured event data, then evaluates triggers.
    """
    job_id = "calendar_watch"
    now = datetime.now(CDT)

    # Ask the general skillset to fetch upcoming events
    result = await run_skillset_prompt(
        job_id=job_id,
        skillset="general",
        prompt=(
            "Check ALL 4 Google Calendars for events in the next 48 hours. "
            "For each event, report EXACTLY in this format (one per line):\n"
            "EVENT|<calendar_id>|<event_id>|<start_datetime_ISO>|<event_title>\n\n"
            "If no events in the next 48h, respond with NO_REPLY.\n"
            "Do not add any other text — just the EVENT lines or NO_REPLY."
        ),
        timeout_seconds=60,
    )

    log_run(result)

    if result.status != "ok" or not result.output or result.output.strip().upper() == "NO_REPLY":
        logger.debug("Calendar watch: no upcoming events or fetch failed")
        return

    # Parse event lines
    events_triggered = []
    for line in result.output.strip().split("\n"):
        line = line.strip()
        if not line.startswith("EVENT|"):
            continue

        parts = line.split("|", 4)
        if len(parts) < 5:
            continue

        _, cal_id, event_id, start_str, title = parts

        try:
            # Parse ISO datetime
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=CDT)
            hours_until = (start_dt - now.astimezone(start_dt.tzinfo)).total_seconds() / 3600
        except (ValueError, TypeError):
            logger.debug(f"Could not parse datetime: {start_str}")
            continue

        # TTRPG session prep: 24h before (window: 23-25h)
        if TTRPG_CALENDAR in cal_id and 23.0 < hours_until < 25.0:
            if not already_triggered(event_id, "ttrpg_session_prep"):
                logger.info(f"Triggering TTRPG session prep for: {title} (in {hours_until:.1f}h)")
                await _trigger_ttrpg_prep(title, start_dt, router)
                mark_triggered(event_id, "ttrpg_session_prep")
                events_triggered.append(f"TTRPG prep: {title}")

        # Generic 2-hour reminder (window: 1.75-2.25h)
        if 1.75 < hours_until < 2.25:
            if not already_triggered(event_id, "event_reminder"):
                logger.info(f"Triggering 2h reminder for: {title}")
                if router:
                    time_str = start_dt.astimezone(CDT).strftime("%-I:%M %p CDT")
                    await router.route(
                        "event_reminder",
                        NotifyLevel.BRIEFING,
                        f"📅 Reminder: {title} in ~2 hours ({time_str})"
                    )
                mark_triggered(event_id, "event_reminder")
                events_triggered.append(f"Reminder: {title}")

    if events_triggered:
        logger.info(f"Calendar watch triggered {len(events_triggered)} actions")

    # Periodic cleanup
    if now.hour == 3 and now.minute < 30:  # Run cleanup at ~3 AM
        cleanup_old_triggers(30)


async def _trigger_ttrpg_prep(session_title: str, start_dt: datetime, router=None):
    """Run TTRPG session prep when a session is detected 24h out."""
    time_str = start_dt.astimezone(CDT).strftime("%A at %-I:%M %p CDT")

    result = await run_skillset_prompt(
        job_id="ttrpg_session_prep",
        skillset="ttrpg",
        prompt=(
            f"CY_BORG session '{session_title}' is scheduled for {time_str} (tomorrow).\n\n"
            "Run the session prep protocol:\n"
            "1. Read the GM Guide and Session 1 Recap\n"
            "2. Review the Party Roster — where did each PC end up?\n"
            "3. Check the GM Prep Checklist\n"
            "4. Review the NPC Cheat Sheet for anyone relevant\n"
            "5. Check the Escalation Triggers\n\n"
            "Generate a concise session prep summary:\n"
            "- Where we left off\n"
            "- Key NPCs to have ready\n"
            "- Likely player actions and your responses\n"
            "- 2-3 dramatic moments to aim for\n"
            "- Any rules to review\n\n"
            "Keep it GM-focused and actionable."
        ),
        timeout_seconds=180,
    )

    result.notify_level = NotifyLevel.BRIEFING.value
    log_run(result)

    if router:
        msg = result.output or f"Session prep for '{session_title}' failed. Do manual prep."
        if result.status == "error":
            msg = f"⚠️ TTRPG session prep failed: {result.error}\n\nSession: {session_title} on {time_str}"
        await router.route("ttrpg_session_prep", NotifyLevel.BRIEFING, f"🎮 SESSION PREP — {session_title}\n\n{msg}")
