"""Settings endpoints for JARVIS — API key management, preferences, and control routes."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from pathlib import Path

import anthropic
import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from jarvis_auth import verify_token
from jarvis_tts import FISH_VOICE_ID
from jarvis_usage import _session_start

from calendar_access import get_todays_events
from mail_access import get_unread_count
from memory import get_important_memories, get_open_tasks
from notes_access import get_recent_notes

log = logging.getLogger("jarvis")

settings_router = APIRouter()


# ---------------------------------------------------------------------------
# .env file helpers
# ---------------------------------------------------------------------------

def _env_file_path() -> Path:
    return Path(__file__).parent / ".env"


def _env_example_path() -> Path:
    return Path(__file__).parent / ".env.example"


def _read_env() -> tuple:
    """Read .env file. Returns (raw_lines, parsed_dict). Creates from .env.example if missing."""
    path = _env_file_path()
    if not path.exists():
        example = _env_example_path()
        if example.exists():
            import shutil as _shutil
            _shutil.copy2(str(example), str(path))
        else:
            path.write_text("")
    lines = path.read_text().splitlines()
    parsed: dict = {}
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            k, _, v = stripped.partition("=")
            parsed[k.strip()] = v.strip().strip('"').strip("'")
    return lines, parsed


def _write_env_key(key: str, value: str) -> None:
    """Update a single key in .env, preserving comments and order."""
    lines, _ = _read_env()
    found = False
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            k, _, _ = stripped.partition("=")
            if k.strip() == key:
                new_lines.append(f"{key}={value}")
                found = True
                continue
        new_lines.append(line)
    if not found:
        new_lines.append(f"{key}={value}")
    _env_file_path().write_text("\n".join(new_lines) + "\n")
    os.environ[key] = value


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class KeyUpdate(BaseModel):
    key_name: str
    key_value: str


class KeyTest(BaseModel):
    key_value: str | None = None


class PreferencesUpdate(BaseModel):
    user_name: str = ""
    honorific: str = "sir"
    calendar_accounts: str = "auto"


# ---------------------------------------------------------------------------
# Settings routes
# ---------------------------------------------------------------------------

@settings_router.post("/api/settings/keys")
async def api_settings_keys(body: KeyUpdate, _token: str = Depends(verify_token)):
    allowed = {"ANTHROPIC_API_KEY", "FISH_API_KEY", "FISH_VOICE_ID", "USER_NAME", "HONORIFIC", "CALENDAR_ACCOUNTS"}
    if body.key_name not in allowed:
        return JSONResponse({"success": False, "error": "Invalid key name"}, status_code=400)
    _write_env_key(body.key_name, body.key_value)
    return {"success": True}


@settings_router.post("/api/settings/test-anthropic")
async def api_test_anthropic(body: KeyTest, _token: str = Depends(verify_token)):
    key = body.key_value or os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        return {"valid": False, "error": "No key provided"}
    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        await client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=10, messages=[{"role": "user", "content": "Hi"}])
        return {"valid": True}
    except Exception as e:
        return {"valid": False, "error": str(e)[:200]}


@settings_router.post("/api/settings/test-fish")
async def api_test_fish(body: KeyTest, _token: str = Depends(verify_token)):
    key = body.key_value or os.getenv("FISH_API_KEY", "")
    if not key:
        return {"valid": False, "error": "No key provided"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.fish.audio/v1/tts",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"text": "test", "reference_id": FISH_VOICE_ID},
            )
            if resp.status_code in (200, 201):
                return {"valid": True}
            elif resp.status_code == 401:
                return {"valid": False, "error": "Invalid API key"}
            else:
                return {"valid": False, "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"valid": False, "error": str(e)[:200]}


@settings_router.get("/api/settings/status")
async def api_settings_status(_token: str = Depends(verify_token)):
    import shutil as _shutil
    _, env_dict = _read_env()
    claude_installed = _shutil.which("claude") is not None
    calendar_ok = mail_ok = notes_ok = False
    try: get_todays_events(); calendar_ok = True
    except Exception: pass
    try: get_unread_count(); mail_ok = True
    except Exception: pass
    try: get_recent_notes(limit=1); notes_ok = True
    except Exception: pass
    memory_count = task_count = 0
    try: memory_count = len(get_important_memories(limit=9999))
    except Exception: pass
    try: task_count = len(get_open_tasks())
    except Exception: pass
    return {
        "claude_code_installed": claude_installed,
        "calendar_accessible": calendar_ok,
        "mail_accessible": mail_ok,
        "notes_accessible": notes_ok,
        "memory_count": memory_count,
        "task_count": task_count,
        "server_port": 8340,
        "uptime_seconds": int(time.time() - _session_start),
        "env_keys_set": {
            "anthropic": bool(env_dict.get("ANTHROPIC_API_KEY", "").strip() and env_dict.get("ANTHROPIC_API_KEY", "") != "your-anthropic-api-key-here"),
            "fish_audio": bool(env_dict.get("FISH_API_KEY", "").strip() and env_dict.get("FISH_API_KEY", "") != "your-fish-audio-api-key-here"),
            "fish_voice_id": bool(env_dict.get("FISH_VOICE_ID", "").strip()),
            "user_name": env_dict.get("USER_NAME", ""),
        },
    }


@settings_router.get("/api/settings/preferences")
async def api_get_preferences(_token: str = Depends(verify_token)):
    _, env_dict = _read_env()
    return {
        "user_name": env_dict.get("USER_NAME", ""),
        "honorific": env_dict.get("HONORIFIC", "sir"),
        "calendar_accounts": env_dict.get("CALENDAR_ACCOUNTS", "auto"),
    }


@settings_router.post("/api/settings/preferences")
async def api_save_preferences(body: PreferencesUpdate, _token: str = Depends(verify_token)):
    _write_env_key("USER_NAME", body.user_name)
    _write_env_key("HONORIFIC", body.honorific)
    _write_env_key("CALENDAR_ACCOUNTS", body.calendar_accounts)
    return {"success": True}


# ---------------------------------------------------------------------------
# Control endpoints (restart, fix-self)
# ---------------------------------------------------------------------------

@settings_router.post("/api/restart")
async def api_restart(_token: str = Depends(verify_token)):
    """Restart the JARVIS server."""
    log.info("Restart requested — shutting down in 2 seconds")
    async def _restart():
        await asyncio.sleep(2)
        cmd = [sys.executable, __file__, "--port", "8340", "--host", "0.0.0.0"]
        os.execv(sys.executable, cmd)
    asyncio.create_task(_restart())
    return {"status": "restarting"}


@settings_router.post("/api/fix-self")
async def api_fix_self(_token: str = Depends(verify_token)):
    """Enter work mode in the JARVIS repo — JARVIS can now fix himself."""
    jarvis_dir = str(Path(__file__).parent)
    # The work_session is per-WebSocket, so we set a flag that the handler picks up
    # For now, also open Terminal so user can see
    script = (
        'tell application "Terminal"\n'
        '    activate\n'
        f'    do script "cd {jarvis_dir} && claude --dangerously-skip-permissions"\n'
        'end tell'
    )
    await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    log.info("Work mode: JARVIS repo opened for self-improvement")
    return {"status": "work_mode_active", "path": jarvis_dir}
