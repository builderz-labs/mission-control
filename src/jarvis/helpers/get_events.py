#!/usr/bin/env python3
"""Fast calendar event fetcher — runs per-calendar AppleScript in parallel with timeouts."""

import asyncio
import os
import sys

# Set CALENDAR_ACCOUNTS env var to a comma-separated list of calendar names/emails,
# or leave empty to auto-discover all calendars from Apple Calendar.
_calendar_accounts_env = os.getenv("CALENDAR_ACCOUNTS", "")
CALENDARS: list[str] = [
    a.strip() for a in _calendar_accounts_env.split(",") if a.strip()
] if _calendar_accounts_env.strip() else []

SCRIPT_TEMPLATE = '''
tell application "Calendar"
    set cal to calendar "{cal_name}"
    set allStarts to start date of every event of cal
    set allSummaries to summary of every event of cal
    set allAllDay to allday event of every event of cal
    set todayStart to current date
    set time of todayStart to 0
    set todayEnd to todayStart + (1 * days)
    set output to ""
    repeat with i from 1 to count of allStarts
        set s to item i of allStarts
        if s >= todayStart and s < todayEnd then
            set h to hours of s
            set m to minutes of s
            if item i of allAllDay then
                set timeStr to "ALL_DAY"
            else
                if h > 12 then
                    set timeStr to ((h - 12) as string) & ":" & (text -2 thru -1 of ("0" & m)) & " PM"
                else if h = 0 then
                    set timeStr to "12:" & (text -2 thru -1 of ("0" & m)) & " AM"
                else if h = 12 then
                    set timeStr to "12:" & (text -2 thru -1 of ("0" & m)) & " PM"
                else
                    set timeStr to (h as string) & ":" & (text -2 thru -1 of ("0" & m)) & " AM"
                end if
            end if
            set output to output & "{cal_name}" & "|||" & item i of allSummaries & "|||" & timeStr & "|||" & item i of allAllDay & linefeed
        end if
    end repeat
    return output
end tell
'''


async def fetch_calendar(cal_name: str, timeout: float = 5.0) -> str:
    script = SCRIPT_TEMPLATE.replace("{cal_name}", cal_name)
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return stdout.decode().strip()
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return ""
    except Exception:
        return ""


async def discover_calendars() -> list[str]:
    """Auto-discover all calendar names from Apple Calendar."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e",
            'tell application "Calendar" to return name of every calendar',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        if proc.returncode == 0:
            return [c.strip() for c in stdout.decode().strip().split(",") if c.strip()]
    except Exception:
        pass
    return []


async def main():
    global CALENDARS
    if not CALENDARS:
        CALENDARS = await discover_calendars()
        if not CALENDARS:
            print("No calendars found. Set CALENDAR_ACCOUNTS env var.", file=sys.stderr)
            return
    results = await asyncio.gather(*[fetch_calendar(c) for c in CALENDARS])
    for result in results:
        if result:
            print(result)


if __name__ == "__main__":
    asyncio.run(main())
