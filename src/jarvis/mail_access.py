"""
JARVIS Mail Access — READ-ONLY access to Apple Mail.

Any accounts synced to Mail.app (Gmail, iCloud, Exchange, etc.)
are automatically available. No OAuth needed.

IMPORTANT: This module is intentionally READ-ONLY.
No send, delete, move, or modify functions exist by design.
"""

import asyncio
import logging
from datetime import datetime

log = logging.getLogger("jarvis.mail")

_mail_launched = False


async def _ensure_mail_running():
    """Launch Mail.app if not already running."""
    global _mail_launched
    if _mail_launched:
        return

    check = 'tell application "System Events" to return (name of every application process) contains "Mail"'
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", check,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
        if "true" in stdout.decode().lower():
            _mail_launched = True
            return
    except Exception:
        pass

    try:
        proc = await asyncio.create_subprocess_exec(
            "open", "-a", "Mail", "-g",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=5)
        await asyncio.sleep(2)
        _mail_launched = True
        log.info("Mail.app launched")
    except Exception as e:
        log.warning(f"Failed to launch Mail: {e}")


async def _run_mail_script(script: str, timeout: float = 20) -> str:
    """Run an AppleScript against Mail.app and return output."""
    await _ensure_mail_running()
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        if proc.returncode != 0:
            err = stderr.decode().strip()[:200]
            log.warning(f"Mail script failed: {err}")
            return ""

        return stdout.decode().strip()
    except asyncio.TimeoutError:
        log.warning("Mail script timed out")
        return ""
    except Exception as e:
        log.warning(f"Mail script error: {e}")
        return ""


async def get_accounts() -> list[str]:
    """Get list of configured mail account names."""
    script = """
tell application "Mail"
    return name of every account
end tell
"""
    raw = await _run_mail_script(script)
    if not raw:
        return []
    return [a.strip() for a in raw.split(",") if a.strip()]


async def get_unread_count() -> dict:
    """Get unread message count per account and total.

    Returns: {"total": int, "accounts": {"Google": 5, "Work": 3, ...}}
    """
    script = """
tell application "Mail"
    set totalUnread to unread count of inbox
    set output to "total:" & totalUnread & linefeed
    repeat with acct in every account
        set acctName to name of acct
        try
            set acctUnread to unread count of mailbox "INBOX" of acct
            set output to output & acctName & ":" & acctUnread & linefeed
        end try
    end repeat
    return output
end tell
"""
    raw = await _run_mail_script(script)
    result = {"total": 0, "accounts": {}}
    for line in raw.split("\n"):
        line = line.strip()
        if ":" in line:
            key, _, val = line.partition(":")
            try:
                count = int(val.strip())
                if key.strip() == "total":
                    result["total"] = count
                else:
                    result["accounts"][key.strip()] = count
            except ValueError:
                pass
    return result


async def get_recent_messages(count: int = 10) -> list[dict]:
    """Get most recent messages from unified inbox.

    Returns list of {"sender", "subject", "date", "read", "account", "preview"}.
    """
    script = f"""
tell application "Mail"
    set allMsgs to messages of inbox
    set msgCount to count of allMsgs
    set limit to msgCount
    if limit > {count} then set limit to {count}
    set output to ""
    repeat with i from 1 to limit
        set m to item i of allMsgs
        set s to sender of m
        set subj to subject of m
        set d to date received of m as string
        set r to read status of m
        -- Get a short preview (first 150 chars of content)
        set prev to ""
        try
            set rawContent to content of m
            if length of rawContent > 150 then
                set prev to text 1 thru 150 of rawContent
            else
                set prev to rawContent
            end if
        end try
        -- Replace any ||| in content to avoid breaking our delimiter
        set output to output & s & "|||" & subj & "|||" & d & "|||" & r & "|||" & prev & linefeed
    end repeat
    return output
end tell
"""
    raw = await _run_mail_script(script, timeout=20)
    if not raw:
        return []

    messages = []
    for line in raw.split("\n"):
        parts = line.strip().split("|||")
        if len(parts) >= 4:
            messages.append({
                "sender": parts[0].strip(),
                "subject": parts[1].strip(),
                "date": parts[2].strip(),
                "read": parts[3].strip().lower() == "true",
                "preview": parts[4].strip() if len(parts) > 4 else "",
            })
    return messages


async def get_unread_messages(count: int = 10) -> list[dict]:
    """Get unread messages from unified inbox."""
    script = f"""
tell application "Mail"
    set allMsgs to messages of inbox whose read status is false
    set msgCount to count of allMsgs
    set limit to msgCount
    if limit > {count} then set limit to {count}
    set output to ""
    repeat with i from 1 to limit
        set m to item i of allMsgs
        set s to sender of m
        set subj to subject of m
        set d to date received of m as string
        set prev to ""
        try
            set rawContent to content of m
            if length of rawContent > 150 then
                set prev to text 1 thru 150 of rawContent
            else
                set prev to rawContent
            end if
        end try
        set output to output & s & "|||" & subj & "|||" & d & "|||" & prev & linefeed
    end repeat
    return output
end tell
"""
    raw = await _run_mail_script(script, timeout=20)
    if not raw:
        return []

    messages = []
    for line in raw.split("\n"):
        parts = line.strip().split("|||")
        if len(parts) >= 3:
            messages.append({
                "sender": parts[0].strip(),
                "subject": parts[1].strip(),
                "date": parts[2].strip(),
                "read": False,
                "preview": parts[3].strip() if len(parts) > 3 else "",
            })
    return messages


async def get_messages_from_account(account_name: str, count: int = 10) -> list[dict]:
    """Get recent messages from a specific account's inbox."""
    escaped = account_name.replace('"', '\\"')
    script = f"""
tell application "Mail"
    set acctMsgs to messages of mailbox "INBOX" of account "{escaped}"
    set msgCount to count of acctMsgs
    set limit to msgCount
    if limit > {count} then set limit to {count}
    set output to ""
    repeat with i from 1 to limit
        set m to item i of acctMsgs
        set s to sender of m
        set subj to subject of m
        set d to date received of m as string
        set r to read status of m
        set output to output & s & "|||" & subj & "|||" & d & "|||" & r & linefeed
    end repeat
    return output
end tell
"""
    raw = await _run_mail_script(script, timeout=20)
    if not raw:
        return []

    messages = []
    for line in raw.split("\n"):
        parts = line.strip().split("|||")
        if len(parts) >= 4:
            messages.append({
                "sender": parts[0].strip(),
                "subject": parts[1].strip(),
                "date": parts[2].strip(),
                "read": parts[3].strip().lower() == "true",
            })
    return messages


async def search_mail(query: str, count: int = 10) -> list[dict]:
    """Search mail by subject or sender keyword.

    Uses AppleScript filtering on subject. For broader search,
    we check both subject and sender.
    """
    escaped = query.replace('"', '\\"').replace("\\", "\\\\")
    script = f"""
tell application "Mail"
    set output to ""
    set foundCount to 0
    set allMsgs to messages of inbox
    repeat with m in allMsgs
        if foundCount >= {count} then exit repeat
        set subj to subject of m
        set s to sender of m
        if subj contains "{escaped}" or s contains "{escaped}" then
            set d to date received of m as string
            set r to read status of m
            set output to output & s & "|||" & subj & "|||" & d & "|||" & r & linefeed
            set foundCount to foundCount + 1
        end if
    end repeat
    return output
end tell
"""
    raw = await _run_mail_script(script, timeout=30)
    if not raw:
        return []

    messages = []
    for line in raw.split("\n"):
        parts = line.strip().split("|||")
        if len(parts) >= 4:
            messages.append({
                "sender": parts[0].strip(),
                "subject": parts[1].strip(),
                "date": parts[2].strip(),
                "read": parts[3].strip().lower() == "true",
            })
    return messages


async def read_message(subject_match: str) -> dict | None:
    """Read the full content of a message matching the subject.

    Returns {"sender", "subject", "date", "content"} or None.
    """
    escaped = subject_match.replace('"', '\\"').replace("\\", "\\\\")
    script = f"""
tell application "Mail"
    set allMsgs to messages of inbox
    repeat with m in allMsgs
        if subject of m contains "{escaped}" then
            set s to sender of m
            set subj to subject of m
            set d to date received of m as string
            set c to content of m
            -- Truncate very long emails
            if length of c > 3000 then
                set c to text 1 thru 3000 of c
            end if
            return s & "|||" & subj & "|||" & d & "|||" & c
        end if
    end repeat
    return ""
end tell
"""
    raw = await _run_mail_script(script, timeout=20)
    if not raw:
        return None

    parts = raw.split("|||", 3)
    if len(parts) >= 4:
        return {
            "sender": parts[0].strip(),
            "subject": parts[1].strip(),
            "date": parts[2].strip(),
            "content": parts[3].strip(),
        }
    return None


def format_unread_summary(unread: dict) -> str:
    """Format unread counts for voice."""
    total = unread["total"]
    if total == 0:
        return "Inbox is clear, sir. No unread messages."

    parts = []
    for acct, count in unread["accounts"].items():
        if count > 0:
            parts.append(f"{count} in {acct}")

    if len(parts) == 1:
        return f"You have {total} unread {'message' if total == 1 else 'messages'} — {parts[0]}."
    elif parts:
        return f"You have {total} unread messages: {', '.join(parts)}."
    else:
        return f"You have {total} unread {'message' if total == 1 else 'messages'}."


def format_messages_for_context(messages: list[dict], label: str = "Recent emails") -> str:
    """Format messages as context for the LLM."""
    if not messages:
        return f"{label}: None."

    lines = [f"{label}:"]
    for m in messages[:10]:
        read_marker = "" if m.get("read") else " [UNREAD]"
        line = f"  - {m['sender']}: {m['subject']}{read_marker}"
        if m.get("date"):
            # Try to shorten the date
            date_str = m["date"]
            if " at " in date_str:
                date_str = date_str.split(" at ")[0].split(", ", 1)[-1] if ", " in date_str else date_str
            line += f" ({date_str})"
        lines.append(line)
    return "\n".join(lines)


def format_messages_for_voice(messages: list[dict]) -> str:
    """Format messages for voice response."""
    if not messages:
        return "No messages to report, sir."

    count = len(messages)
    if count == 1:
        m = messages[0]
        sender = _short_sender(m["sender"])
        return f"One message from {sender}: {m['subject']}."

    summaries = []
    for m in messages[:5]:
        sender = _short_sender(m["sender"])
        summaries.append(f"{sender} regarding {m['subject']}")

    result = f"You have {count} messages. "
    result += ". ".join(summaries[:3])
    if count > 3:
        result += f". And {count - 3} more."
    return result


def _short_sender(sender: str) -> str:
    """Extract just the name from an email sender string like 'John Doe <john@example.com>'."""
    if "<" in sender:
        return sender.split("<")[0].strip().strip('"')
    if "@" in sender:
        return sender.split("@")[0]
    return sender
