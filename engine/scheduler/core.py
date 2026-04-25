"""RoceOS Scheduler Core — APScheduler wrapper with persistence and observability."""
import asyncio
import logging
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Awaitable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.triggers.cron import CronTrigger

from config import settings

logger = logging.getLogger("roceos.scheduler")

# ── Result tracking ──────────────────────────────────────────────────────────


@dataclass
class JobResult:
    job_id: str
    skillset: str
    status: str  # "ok", "error", "no_reply", "timeout"
    output: str = ""
    error: str = ""
    duration_ms: int = 0
    notify_level: str = "silent"


# ── Run history database ─────────────────────────────────────────────────────

_history_db: str = ""


def _init_history_db(db_path: str):
    global _history_db
    _history_db = db_path
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scheduler_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL DEFAULT (datetime('now')),
            job_id TEXT NOT NULL,
            skillset TEXT NOT NULL,
            status TEXT NOT NULL,
            output TEXT,
            error TEXT,
            duration_ms INTEGER,
            notify_level TEXT
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_runs_job ON scheduler_runs(job_id, ts DESC)
    """)
    conn.commit()
    conn.close()


def log_run(result: JobResult):
    """Persist a job run result."""
    if not _history_db:
        return
    try:
        conn = sqlite3.connect(_history_db, timeout=10)
        conn.execute(
            "INSERT INTO scheduler_runs (job_id, skillset, status, output, error, duration_ms, notify_level) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (result.job_id, result.skillset, result.status,
             result.output[:2000] if result.output else None,
             result.error[:500] if result.error else None,
             result.duration_ms, result.notify_level),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to log run for {result.job_id}: {e}")


def get_recent_runs(limit: int = 50) -> list[dict]:
    """Fetch recent scheduler run history."""
    if not _history_db:
        return []
    conn = sqlite3.connect(_history_db, timeout=10)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM scheduler_runs ORDER BY ts DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_consecutive_failures(job_id: str) -> int:
    """Count consecutive failures for cascade detection."""
    if not _history_db:
        return 0
    conn = sqlite3.connect(_history_db, timeout=10)
    rows = conn.execute(
        "SELECT status FROM scheduler_runs WHERE job_id=? ORDER BY ts DESC LIMIT 10",
        (job_id,)
    ).fetchall()
    conn.close()
    count = 0
    for row in rows:
        if row[0] == "error":
            count += 1
        else:
            break
    return count


# ── Scheduler factory ────────────────────────────────────────────────────────

_scheduler: AsyncIOScheduler | None = None
_process_message_fn: Callable | None = None


def create_scheduler(db_path: str) -> AsyncIOScheduler:
    """Create and configure the APScheduler instance."""
    global _scheduler

    history_path = db_path.replace(".db", "_runs.db")
    _init_history_db(history_path)

    jobstore_url = f"sqlite:///{db_path}"

    _scheduler = AsyncIOScheduler(
        jobstores={"default": SQLAlchemyJobStore(url=jobstore_url)},
        job_defaults={
            "coalesce": True,       # If missed, run once (not N times)
            "max_instances": 1,     # Never overlap same job
            "misfire_grace_time": 300,  # 5 min grace for misfires
        },
        timezone="America/Chicago",
    )

    # Global error listener
    _scheduler.add_listener(_on_job_error, 4)  # EVENT_JOB_ERROR = 4
    _scheduler.add_listener(_on_job_executed, 8)  # EVENT_JOB_EXECUTED = 8

    logger.info(f"Scheduler created (timezone=America/Chicago, jobstore={db_path})")
    return _scheduler


def get_scheduler() -> AsyncIOScheduler | None:
    return _scheduler


def set_process_message(fn: Callable):
    """Set the process_message function reference for jobs to use."""
    global _process_message_fn
    _process_message_fn = fn


async def run_skillset_prompt(
    job_id: str,
    skillset: str,
    prompt: str,
    timeout_seconds: int = 120,
) -> JobResult:
    """Execute a prompt through a skillset and return the result.

    This is the core function that all scheduled jobs call.
    """
    if not _process_message_fn:
        return JobResult(
            job_id=job_id, skillset=skillset, status="error",
            error="process_message not initialized",
        )

    t0 = time.monotonic()
    # For scheduled jobs, use a short tool-focused system prompt
    # instead of the full skillset prompt (which confuses tool execution)
    TOOL_SYSTEM_PROMPT = (
        "You have Bash, Read, WebFetch, and Grep tools. USE THEM.\n"
        "Trading database: /opt/trading-workspace/trading/data/trading.db (use sqlite3)\n"
        "Cron logs: /var/log/trading-cron/\n"
        "ALWAYS run actual commands to get real data. NEVER say you can't access something."
    )

    # Import and call claude -p directly with the short prompt
    from llm_failover import llm_call
    try:
        response = await asyncio.wait_for(
            llm_call(
                prompt=prompt,
                system_prompt=TOOL_SYSTEM_PROMPT,
                model="haiku",
                tools="Bash,Read,WebFetch,Grep",
            ),
            timeout=timeout_seconds,
        )
        duration = int((time.monotonic() - t0) * 1000)

        # Check for NO_REPLY convention
        if response and response.strip().upper() == "NO_REPLY":
            return JobResult(
                job_id=job_id, skillset=skillset, status="no_reply",
                output="", duration_ms=duration, notify_level="silent",
            )

        return JobResult(
            job_id=job_id, skillset=skillset, status="ok",
            output=response, duration_ms=duration,
        )

    except asyncio.TimeoutError:
        duration = int((time.monotonic() - t0) * 1000)
        return JobResult(
            job_id=job_id, skillset=skillset, status="timeout",
            error=f"Timed out after {timeout_seconds}s",
            duration_ms=duration,
        )
    except Exception as e:
        duration = int((time.monotonic() - t0) * 1000)
        return JobResult(
            job_id=job_id, skillset=skillset, status="error",
            error=str(e), duration_ms=duration,
        )


# ── Job registration helper ──────────────────────────────────────────────────

def register_job(
    job_id: str,
    func: Callable,
    cron: str,
    **kwargs,
):
    """Register a cron job with the scheduler.

    Args:
        job_id: Unique job identifier
        func: Async function to call
        cron: Cron expression (5-field, CDT timezone)
        **kwargs: Extra args passed to the job function
    """
    if not _scheduler:
        logger.error(f"Cannot register {job_id} — scheduler not created")
        return

    parts = cron.split()
    if len(parts) == 5:
        trigger = CronTrigger(
            minute=parts[0], hour=parts[1], day=parts[2],
            month=parts[3], day_of_week=parts[4],
            timezone="America/Chicago",
        )
    else:
        logger.error(f"Invalid cron for {job_id}: {cron}")
        return

    _scheduler.add_job(
        func, trigger,
        id=job_id, replace_existing=True,
        kwargs=kwargs,
    )
    logger.info(f"Registered job: {job_id} [{cron}]")


# ── Event listeners ──────────────────────────────────────────────────────────

def _on_job_error(event):
    logger.error(f"Job {event.job_id} failed: {event.exception}")


def _on_job_executed(event):
    logger.debug(f"Job {event.job_id} executed successfully")
