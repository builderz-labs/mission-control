"""Action tools — let skillsets DO things (SSH, HTTP, file operations).

These tools give skillsets real capabilities beyond conversation:
- SSH: Execute commands on VPS for monitoring, diagnostics, deployments
- HTTP: Query external APIs (weather, GitHub, etc.)
- File: Read context files and configs
"""
import asyncio
import logging
import os
import subprocess

import httpx
from langchain_core.tools import tool

from config import settings

logger = logging.getLogger("roceos.action_tools")

# Safety: commands that are never allowed
BLOCKED_COMMANDS = [
    "rm -rf /", "mkfs", "dd if=", "> /dev/sd",
    "shutdown", "reboot", "halt", "poweroff",
    "passwd", "userdel", "deluser",
]

# Safety: only these hosts are allowed for SSH
ALLOWED_SSH_HOSTS = ["187.127.96.74", "localhost"]


@tool
def run_ssh_command(command: str, host: str = "187.127.96.74") -> str:
    """Execute a command on the VPS via SSH.

    Use this for system monitoring, Docker management, log checking,
    network diagnostics, and administrative tasks.

    SAFETY: Destructive commands (rm -rf /, reboot, etc.) are blocked.
    Only connects to known hosts (VPS at 187.127.96.74).

    Args:
        command: The shell command to execute
        host: SSH host (default: VPS at 187.127.96.74)

    Returns:
        Command output (stdout + stderr), truncated to 4000 chars

    Examples:
        run_ssh_command("docker ps --format 'table {{.Names}}\\t{{.Status}}'")
        run_ssh_command("df -h /")
        run_ssh_command("docker logs roceos-engine --tail 20")
        run_ssh_command("free -h")
        run_ssh_command("uptime")
    """
    # Security checks
    if host not in ALLOWED_SSH_HOSTS:
        return f"Error: Host '{host}' not in allowed list: {ALLOWED_SSH_HOSTS}"

    for blocked in BLOCKED_COMMANDS:
        if blocked in command:
            return f"Error: Command blocked for safety: contains '{blocked}'"

    try:
        result = subprocess.run(
            ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
             f"root@{host}", command],
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += f"\n[stderr] {result.stderr}"

        if not output.strip():
            output = "(no output)"

        # Truncate long outputs
        if len(output) > 4000:
            output = output[:4000] + "\n\n[... truncated]"

        return output

    except subprocess.TimeoutExpired:
        return "Error: Command timed out (30s limit)"
    except Exception as e:
        return f"Error: {str(e)}"


@tool
async def http_get(url: str, headers: str = "") -> str:
    """Make an HTTP GET request to an external API.

    Use this for:
    - Weather data (wttr.in, weather APIs)
    - GitHub API (repos, issues, PRs)
    - Any public API that returns useful data

    SAFETY: Only HTTPS URLs or localhost are allowed.

    Args:
        url: The URL to fetch (must be https:// or http://localhost)
        headers: Optional JSON string of headers (e.g., '{"Authorization": "token xxx"}')

    Returns:
        Response body (truncated to 4000 chars)

    Examples:
        http_get("https://wttr.in/Huntsville+AL?format=3")
        http_get("https://api.github.com/users/spaceghostroce/repos")
    """
    import json as json_module

    # Security: only allow HTTPS or localhost
    if not (url.startswith("https://") or url.startswith("http://localhost")):
        return "Error: Only HTTPS URLs or localhost allowed."

    parsed_headers = {}
    if headers:
        try:
            parsed_headers = json_module.loads(headers)
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=parsed_headers)

            content = resp.text
            if len(content) > 4000:
                content = content[:4000] + "\n\n[... truncated]"

            return f"HTTP {resp.status_code}\n{content}"

    except httpx.TimeoutException:
        return "Error: Request timed out (15s)"
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def check_weather(location: str = "Huntsville AL") -> str:
    """Get current weather conditions for a location.

    Args:
        location: City and state (default: Huntsville AL)

    Returns:
        Current weather summary
    """
    try:
        # Use wttr.in for simple weather (no API key needed)
        result = subprocess.run(
            ["curl", "-s", f"https://wttr.in/{location.replace(' ', '+')}?format=%C+%t+%w+%h"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return f"Weather in {location}: {result.stdout.strip()}"
        return f"Could not fetch weather for {location}"
    except Exception as e:
        return f"Error: {str(e)}"


# Tool collections
SSH_TOOLS = [run_ssh_command]
HTTP_TOOLS = [http_get, check_weather]
ACTION_TOOLS = SSH_TOOLS + HTTP_TOOLS
