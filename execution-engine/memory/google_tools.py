"""Google service tools — Calendar, Gmail, Drive.

Uses OAuth2 refresh token from google_token.json.
Run scripts/google_oauth_setup.py locally first to generate the token.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx
from langchain_core.tools import tool

from config import settings

logger = logging.getLogger("roceos.google")

# Google API base URLs
CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GMAIL_API = "https://www.googleapis.com/gmail/v1"
DRIVE_API = "https://www.googleapis.com/drive/v3"

# Ross's calendars
CALENDARS = {
    "primary": "roce.hickey@gmail.com",
    "family": "sqe2bl9dr18osdjd08mpdb9qug@group.calendar.google.com",
    "ttrpg": "aab9c30892c45e74413e9a549fff4ac57af5f7c11ee13a8158abb412111b84b5@group.calendar.google.com",
    "lohickey": "family00304722653063627796@group.calendar.google.com",
}


async def _get_access_token() -> str | None:
    """Get a valid access token, refreshing if needed."""
    token_path = settings.google_token_path
    if not os.path.exists(token_path):
        return None

    with open(token_path) as f:
        token_data = json.load(f)

    # Try to refresh the token
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            data={
                "client_id": token_data["client_id"],
                "client_secret": token_data["client_secret"],
                "refresh_token": token_data["refresh_token"],
                "grant_type": "refresh_token",
            },
        )

        if resp.status_code == 200:
            new_token = resp.json()
            # Update stored token
            token_data["token"] = new_token["access_token"]
            with open(token_path, "w") as f:
                json.dump(token_data, f, indent=2)
            return new_token["access_token"]

    # Fall back to existing token (might be expired)
    return token_data.get("token")


async def _google_get(url: str, params: dict = None) -> dict | str:
    """Make an authenticated GET request to a Google API."""
    token = await _get_access_token()
    if not token:
        return "Google not connected. Run scripts/google_oauth_setup.py locally and copy token.json to VPS."

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params=params or {},
        )

        if resp.status_code == 200:
            return resp.json()
        return f"Google API error: {resp.status_code} {resp.text[:200]}"


# ── Calendar Tools ──

@tool
async def google_calendar_today() -> str:
    """Get today's events across all of Ross's Google Calendars.

    Returns events from: Primary, LoHickey Family, TTRPG, Family calendars.
    Times shown in CDT (America/Chicago).
    """
    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=5, minute=0, second=0)  # ~midnight CDT
    end_of_day = start_of_day + timedelta(days=1)

    all_events = []

    for cal_name, cal_id in CALENDARS.items():
        result = await _google_get(
            f"{CALENDAR_API}/calendars/{cal_id}/events",
            params={
                "timeMin": start_of_day.isoformat(),
                "timeMax": end_of_day.isoformat(),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "20",
            },
        )

        if isinstance(result, str):
            continue  # API error, skip this calendar

        for event in result.get("items", []):
            start = event.get("start", {})
            time_str = start.get("dateTime", start.get("date", "all-day"))
            all_events.append({
                "calendar": cal_name,
                "time": time_str,
                "summary": event.get("summary", "(no title)"),
            })

    if not all_events:
        return "No events today across any calendar."

    # Sort by time
    all_events.sort(key=lambda e: e["time"])

    lines = ["Today's events:"]
    for e in all_events:
        # Parse and format time
        time_display = e["time"]
        if "T" in time_display:
            try:
                dt = datetime.fromisoformat(time_display)
                time_display = dt.strftime("%-I:%M %p")
            except Exception:
                pass

        lines.append(f"  {time_display} — {e['summary']} [{e['calendar']}]")

    return "\n".join(lines)


@tool
async def google_calendar_upcoming(days: int = 7) -> str:
    """Get upcoming events for the next N days across all calendars.

    Args:
        days: Number of days ahead to look (default: 7)
    """
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days)

    all_events = []

    for cal_name, cal_id in CALENDARS.items():
        result = await _google_get(
            f"{CALENDAR_API}/calendars/{cal_id}/events",
            params={
                "timeMin": now.isoformat(),
                "timeMax": end.isoformat(),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "50",
            },
        )

        if isinstance(result, str):
            continue

        for event in result.get("items", []):
            start = event.get("start", {})
            time_str = start.get("dateTime", start.get("date", ""))
            all_events.append({
                "calendar": cal_name,
                "time": time_str,
                "summary": event.get("summary", "(no title)"),
            })

    if not all_events:
        return f"No events in the next {days} days."

    all_events.sort(key=lambda e: e["time"])

    lines = [f"Next {days} days:"]
    current_date = ""
    for e in all_events:
        time_display = e["time"]
        date_display = ""
        if "T" in time_display:
            try:
                dt = datetime.fromisoformat(time_display)
                date_display = dt.strftime("%a %b %d")
                time_display = dt.strftime("%-I:%M %p")
            except Exception:
                pass
        elif time_display:
            date_display = time_display

        if date_display != current_date:
            current_date = date_display
            lines.append(f"\n{date_display}:")

        lines.append(f"  {time_display} — {e['summary']} [{e['calendar']}]")

    return "\n".join(lines)


# ── Gmail Tools ──

@tool
async def gmail_unread(max_results: int = 10) -> str:
    """Check for unread emails in Gmail.

    Args:
        max_results: Maximum number of emails to return (default: 10)

    Returns:
        List of unread emails with sender, subject, and time.
    """
    result = await _google_get(
        f"{GMAIL_API}/users/me/messages",
        params={
            "q": "is:unread",
            "maxResults": str(max_results),
        },
    )

    if isinstance(result, str):
        return result

    messages = result.get("messages", [])
    if not messages:
        return "No unread emails."

    lines = [f"{len(messages)} unread email(s):"]

    for msg_ref in messages[:max_results]:
        # Gmail needs repeated metadataHeaders params, use full format
        token = await _get_access_token()
        if not token:
            continue

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{GMAIL_API}/users/me/messages/{msg_ref['id']}",
                headers={"Authorization": f"Bearer {token}"},
                params=[
                    ("format", "full"),
                ],
            )

            if resp.status_code != 200:
                continue

            msg = resp.json()

        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        lines.append(
            f"  From: {headers.get('From', 'unknown')}\n"
            f"  Subject: {headers.get('Subject', '(no subject)')}\n"
            f"  Date: {headers.get('Date', '')}\n"
        )

    return "\n".join(lines)


# ── Calendar Write ──

@tool
async def google_calendar_create_event(
    title: str,
    start_time: str,
    end_time: str,
    calendar: str = "primary",
    description: str = "",
) -> str:
    """Create a new event on a Google Calendar.

    Args:
        title: Event title
        start_time: Start time in ISO format (e.g., "2026-04-21T14:00:00-05:00")
        end_time: End time in ISO format (e.g., "2026-04-21T15:00:00-05:00")
        calendar: Calendar name — "primary", "family", "ttrpg", or "lohickey"
        description: Optional event description

    Returns:
        Confirmation with event link
    """
    cal_id = CALENDARS.get(calendar, CALENDARS["primary"])

    token = await _get_access_token()
    if not token:
        return "Google not connected."

    event_body = {
        "summary": title,
        "start": {"dateTime": start_time, "timeZone": "America/Chicago"},
        "end": {"dateTime": end_time, "timeZone": "America/Chicago"},
    }
    if description:
        event_body["description"] = description

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{CALENDAR_API}/calendars/{cal_id}/events",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=event_body,
        )

        if resp.status_code in (200, 201):
            event = resp.json()
            return f"Event created: {event.get('summary')} — {event.get('htmlLink', 'no link')}"
        return f"Failed to create event: {resp.status_code} {resp.text[:200]}"


# ── Gmail Write ──

@tool
async def gmail_send(to: str, subject: str, body: str) -> str:
    """Send an email via Gmail.

    Args:
        to: Recipient email address
        subject: Email subject line
        body: Email body (plain text)

    Returns:
        Confirmation or error
    """
    import base64

    token = await _get_access_token()
    if not token:
        return "Google not connected."

    # Build RFC 2822 message
    message_text = f"To: {to}\nSubject: {subject}\n\n{body}"
    raw = base64.urlsafe_b64encode(message_text.encode()).decode()

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{GMAIL_API}/users/me/messages/send",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"raw": raw},
        )

        if resp.status_code == 200:
            return f"Email sent to {to}: \"{subject}\""
        return f"Failed to send: {resp.status_code} {resp.text[:200]}"


# ── Google Drive ──

@tool
async def drive_search(query: str, max_results: int = 10) -> str:
    """Search for files in Google Drive.

    Args:
        query: Search query (file name, content keywords, or Drive search syntax)
        max_results: Maximum results to return

    Returns:
        List of matching files with name, type, and last modified date.

    Examples:
        drive_search("CY_BORG")
        drive_search("player handout")
        drive_search("mimeType='application/pdf'")
    """
    result = await _google_get(
        f"{DRIVE_API}/files",
        params={
            "q": f"name contains '{query}' or fullText contains '{query}'",
            "pageSize": str(max_results),
            "fields": "files(id,name,mimeType,modifiedTime,size,webViewLink)",
            "orderBy": "modifiedTime desc",
        },
    )

    if isinstance(result, str):
        return result

    files = result.get("files", [])
    if not files:
        return f"No files found matching: {query}"

    lines = [f"Found {len(files)} file(s):"]
    for f in files:
        size = f.get("size", "")
        size_str = f" ({int(size)//1024}KB)" if size else ""
        lines.append(
            f"  {f['name']}{size_str}\n"
            f"    Type: {f.get('mimeType', 'unknown')}\n"
            f"    Modified: {f.get('modifiedTime', 'unknown')}\n"
            f"    ID: {f['id']}"
        )

    return "\n".join(lines)


@tool
async def drive_read_file(file_id: str) -> str:
    """Read the content of a text/document file from Google Drive.

    Use drive_search first to find the file ID.

    Args:
        file_id: Google Drive file ID (from drive_search results)

    Returns:
        File content (for text files, Google Docs, Sheets exported as text)
    """
    token = await _get_access_token()
    if not token:
        return "Google not connected."

    async with httpx.AsyncClient(timeout=30.0) as client:
        # First get file metadata to determine type
        meta_resp = await client.get(
            f"{DRIVE_API}/files/{file_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"fields": "name,mimeType"},
        )

        if meta_resp.status_code != 200:
            return f"Error getting file: {meta_resp.status_code}"

        meta = meta_resp.json()
        mime = meta.get("mimeType", "")

        # Google Docs/Sheets/Slides → export as plain text
        if "google-apps" in mime:
            export_mime = "text/plain"
            if "spreadsheet" in mime:
                export_mime = "text/csv"

            resp = await client.get(
                f"{DRIVE_API}/files/{file_id}/export",
                headers={"Authorization": f"Bearer {token}"},
                params={"mimeType": export_mime},
            )
        else:
            # Regular file → download content
            resp = await client.get(
                f"{DRIVE_API}/files/{file_id}",
                headers={"Authorization": f"Bearer {token}"},
                params={"alt": "media"},
            )

        if resp.status_code != 200:
            return f"Error reading file: {resp.status_code} {resp.text[:200]}"

        content = resp.text
        if len(content) > 8000:
            content = content[:8000] + "\n\n[... truncated — file too long]"

        return f"File: {meta['name']}\n---\n{content}"


@tool
async def drive_list_folder(folder_name: str = "") -> str:
    """List files in a Google Drive folder.

    Args:
        folder_name: Folder name to search for. If empty, lists recent files.

    Returns:
        List of files in the folder.
    """
    if folder_name:
        # Find the folder first
        folder_result = await _google_get(
            f"{DRIVE_API}/files",
            params={
                "q": f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder'",
                "fields": "files(id,name)",
            },
        )

        if isinstance(folder_result, str):
            return folder_result

        folders = folder_result.get("files", [])
        if not folders:
            return f"Folder '{folder_name}' not found."

        folder_id = folders[0]["id"]
        query = f"'{folder_id}' in parents"
    else:
        query = "trashed=false"

    result = await _google_get(
        f"{DRIVE_API}/files",
        params={
            "q": query,
            "pageSize": "30",
            "fields": "files(id,name,mimeType,modifiedTime)",
            "orderBy": "modifiedTime desc",
        },
    )

    if isinstance(result, str):
        return result

    files = result.get("files", [])
    if not files:
        return "No files found."

    lines = [f"Files in {'/' + folder_name if folder_name else 'recent'}:"]
    for f in files:
        icon = "📁" if "folder" in f.get("mimeType", "") else "📄"
        lines.append(f"  {icon} {f['name']} ({f.get('modifiedTime', '')[:10]})")

    return "\n".join(lines)


# ── Tool Collections ──

GOOGLE_CALENDAR_TOOLS = [google_calendar_today, google_calendar_upcoming, google_calendar_create_event]
GOOGLE_GMAIL_TOOLS = [gmail_unread, gmail_send]
GOOGLE_DRIVE_TOOLS = [drive_search, drive_read_file, drive_list_folder]
GOOGLE_TOOLS = GOOGLE_CALENDAR_TOOLS + GOOGLE_GMAIL_TOOLS + GOOGLE_DRIVE_TOOLS
