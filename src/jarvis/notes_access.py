"""
JARVIS Apple Notes Access — READ + CREATE ONLY.

Can read existing notes and create new ones.
CANNOT edit or delete existing notes (safety).
"""

import asyncio
import logging

log = logging.getLogger("jarvis.notes")


async def _run_notes_script(script: str, timeout: float = 10) -> str:
    """Run an AppleScript against Notes.app."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if proc.returncode != 0:
            log.warning(f"Notes script failed: {stderr.decode()[:200]}")
            return ""
        return stdout.decode().strip()
    except asyncio.TimeoutError:
        log.warning("Notes script timed out")
        return ""
    except Exception as e:
        log.warning(f"Notes script error: {e}")
        return ""


async def get_recent_notes(count: int = 10) -> list[dict]:
    """Get most recent notes (title + creation date)."""
    script = f'''
tell application "Notes"
    set output to ""
    set allNotes to every note
    set limit to count of allNotes
    if limit > {count} then set limit to {count}
    repeat with i from 1 to limit
        set n to item i of allNotes
        set nName to name of n
        set nDate to creation date of n as string
        set nFolder to name of container of n
        set output to output & nName & "|||" & nDate & "|||" & nFolder & linefeed
    end repeat
    return output
end tell
'''
    raw = await _run_notes_script(script, timeout=15)
    if not raw:
        return []
    notes = []
    for line in raw.split("\n"):
        parts = line.strip().split("|||")
        if len(parts) >= 3:
            notes.append({
                "title": parts[0].strip(),
                "date": parts[1].strip(),
                "folder": parts[2].strip(),
            })
    return notes


async def read_note(title_match: str) -> dict | None:
    """Read a note by title (partial match). Returns title + body."""
    escaped = title_match.replace('"', '\\"')
    script = f'''
tell application "Notes"
    set allNotes to every note
    repeat with n in allNotes
        if name of n contains "{escaped}" then
            set nName to name of n
            set nBody to plaintext of n
            -- Truncate very long notes
            if length of nBody > 3000 then
                set nBody to text 1 thru 3000 of nBody
            end if
            return nName & "|||" & nBody
        end if
    end repeat
    return ""
end tell
'''
    raw = await _run_notes_script(script, timeout=10)
    if not raw or "|||" not in raw:
        return None
    title, _, body = raw.partition("|||")
    return {"title": title.strip(), "body": body.strip()}


async def search_notes_apple(query: str, count: int = 5) -> list[dict]:
    """Search notes by title keyword."""
    escaped = query.replace('"', '\\"')
    script = f'''
tell application "Notes"
    set output to ""
    set foundCount to 0
    set allNotes to every note
    repeat with n in allNotes
        if foundCount >= {count} then exit repeat
        if name of n contains "{escaped}" then
            set output to output & name of n & "|||" & (creation date of n as string) & linefeed
            set foundCount to foundCount + 1
        end if
    end repeat
    return output
end tell
'''
    raw = await _run_notes_script(script, timeout=15)
    if not raw:
        return []
    notes = []
    for line in raw.split("\n"):
        parts = line.strip().split("|||")
        if len(parts) >= 2:
            notes.append({"title": parts[0].strip(), "date": parts[1].strip()})
    return notes


async def create_apple_note(title: str, body: str, folder: str = "Notes") -> bool:
    """Create a new note in Apple Notes with HTML support for formatting.

    Supports checklist items: lines starting with "- [ ]" or "- [x]" become checkboxes.
    """
    # Convert markdown-style checklists to HTML
    html_body = _body_to_html(body)

    escaped_title = title.replace('"', '\\"')
    escaped_body = html_body.replace('"', '\\"')
    escaped_folder = folder.replace('"', '\\"')
    script = f'''
tell application "Notes"
    tell folder "{escaped_folder}"
        make new note with properties {{name:"{escaped_title}", body:"{escaped_body}"}}
    end tell
    return "OK"
end tell
'''
    result = await _run_notes_script(script, timeout=10)
    if result == "OK":
        log.info(f"Created Apple Note: {title}")
        return True
    return False


def _body_to_html(body: str) -> str:
    """Convert plain text / markdown to HTML for Apple Notes.

    Supports:
    - Checklist items: "- [ ] task" or "- [x] task" → checkbox
    - Bullet points: "- item" → bullet
    - Numbered lists: "1. item" → numbered
    - Plain text → paragraphs
    """
    import re
    lines = body.split("\n")
    html_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            html_lines.append("<br>")
        elif re.match(r"^-\s*\[x\]\s*", stripped, re.IGNORECASE):
            text = re.sub(r"^-\s*\[x\]\s*", "", stripped, flags=re.IGNORECASE)
            html_lines.append(f'<div><input type="checkbox" checked="checked"> {text}</div>')
        elif re.match(r"^-\s*\[\s?\]\s*", stripped):
            text = re.sub(r"^-\s*\[\s?\]\s*", "", stripped)
            html_lines.append(f'<div><input type="checkbox"> {text}</div>')
        elif re.match(r"^[-*+]\s+", stripped):
            text = re.sub(r"^[-*+]\s+", "", stripped)
            html_lines.append(f"<div>• {text}</div>")
        elif re.match(r"^\d+\.\s+", stripped):
            text = re.sub(r"^\d+\.\s+", "", stripped)
            html_lines.append(f"<div>{stripped}</div>")
        elif stripped.startswith("#"):
            text = re.sub(r"^#+\s*", "", stripped)
            html_lines.append(f"<h2>{text}</h2>")
        else:
            html_lines.append(f"<div>{stripped}</div>")

    return "\n".join(html_lines)


async def get_note_folders() -> list[str]:
    """Get list of note folder names."""
    script = '''
tell application "Notes"
    set output to ""
    repeat with f in every folder
        set output to output & name of f & linefeed
    end repeat
    return output
end tell
'''
    raw = await _run_notes_script(script)
    return [f.strip() for f in raw.split("\n") if f.strip()]
