"""UniFi Network tools — connect to UniFi controller for network management.

Uses direct HTTP requests to the UniFi controller API.
Simpler than running a full MCP server — same capabilities for our needs.

UniFi API auth: POST /api/login → session cookie → use cookie for all requests.
UniFi OS (UDM/UDR): uses /proxy/network/api/ prefix
Legacy controllers: use /api/ prefix directly
"""
import logging

import httpx
from langchain_core.tools import tool

from config import settings

logger = logging.getLogger("roceos.unifi")

# Session cookie storage
_unifi_cookies = None


async def _unifi_login() -> httpx.Cookies | None:
    """Authenticate with UniFi controller and get session cookies."""
    global _unifi_cookies

    if not settings.unifi_host:
        return None

    try:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            resp = await client.post(
                f"https://{settings.unifi_host}/api/auth/login",
                json={
                    "username": settings.unifi_username,
                    "password": settings.unifi_password,
                },
            )

            if resp.status_code == 200:
                _unifi_cookies = resp.cookies
                return _unifi_cookies

            # Try legacy endpoint
            resp = await client.post(
                f"https://{settings.unifi_host}/api/login",
                json={
                    "username": settings.unifi_username,
                    "password": settings.unifi_password,
                },
            )

            if resp.status_code == 200:
                _unifi_cookies = resp.cookies
                return _unifi_cookies

            logger.warning(f"UniFi login failed: {resp.status_code}")
            return None

    except Exception as e:
        logger.warning(f"UniFi login error: {e}")
        return None


async def _unifi_get(path: str) -> dict | str:
    """Make an authenticated GET to the UniFi API."""
    global _unifi_cookies

    if not settings.unifi_host:
        return "UniFi not configured. Set UNIFI_HOST, UNIFI_USERNAME, UNIFI_PASSWORD."

    if _unifi_cookies is None:
        cookies = await _unifi_login()
        if not cookies:
            return "Failed to authenticate with UniFi controller."

    try:
        async with httpx.AsyncClient(verify=False, timeout=15.0, cookies=_unifi_cookies) as client:
            # Try UniFi OS path first
            resp = await client.get(f"https://{settings.unifi_host}/proxy/network/api{path}")

            if resp.status_code == 401:
                # Session expired, re-login
                await _unifi_login()
                async with httpx.AsyncClient(verify=False, timeout=15.0, cookies=_unifi_cookies) as client2:
                    resp = await client2.get(f"https://{settings.unifi_host}/proxy/network/api{path}")

            if resp.status_code == 404:
                # Try legacy path
                async with httpx.AsyncClient(verify=False, timeout=15.0, cookies=_unifi_cookies) as client2:
                    resp = await client2.get(f"https://{settings.unifi_host}/api{path}")

            if resp.status_code == 200:
                return resp.json()

            return f"UniFi API error: {resp.status_code}"

    except Exception as e:
        return f"UniFi error: {e}"


@tool
async def unifi_clients() -> str:
    """List all connected clients (devices) on the UniFi network.

    Returns:
        List of connected devices with name, IP, MAC, type, and signal strength.
    """
    result = await _unifi_get("/s/default/stat/sta")

    if isinstance(result, str):
        return result

    clients = result.get("data", [])
    if not clients:
        return "No clients connected."

    lines = [f"{len(clients)} connected client(s):"]
    for c in sorted(clients, key=lambda x: x.get("hostname", x.get("name", "zzz"))):
        name = c.get("hostname") or c.get("name") or c.get("mac", "unknown")
        ip = c.get("ip", "no IP")
        conn = "WiFi" if c.get("is_wired") is False else "Wired"
        signal = f" ({c.get('rssi', '?')}dBm)" if conn == "WiFi" else ""
        lines.append(f"  {name} — {ip} [{conn}{signal}]")

    return "\n".join(lines)


@tool
async def unifi_devices() -> str:
    """List all UniFi network devices (APs, switches, gateways).

    Returns:
        Device inventory with name, model, IP, firmware, status.
    """
    result = await _unifi_get("/s/default/stat/device")

    if isinstance(result, str):
        return result

    devices = result.get("data", [])
    if not devices:
        return "No UniFi devices found."

    lines = [f"{len(devices)} UniFi device(s):"]
    for d in devices:
        name = d.get("name") or d.get("model", "unknown")
        model = d.get("model", "?")
        ip = d.get("ip", "no IP")
        version = d.get("version", "?")
        status = "online" if d.get("state") == 1 else "offline"
        uptime_s = d.get("uptime", 0)
        uptime = f"{uptime_s // 86400}d {(uptime_s % 86400) // 3600}h" if uptime_s else "?"

        lines.append(f"  {name} ({model}) — {ip} — fw {version} — {status} — up {uptime}")

    return "\n".join(lines)


@tool
async def unifi_network_health() -> str:
    """Get overall network health summary from UniFi controller.

    Returns:
        Network health status including WAN, LAN, WLAN stats.
    """
    result = await _unifi_get("/s/default/stat/health")

    if isinstance(result, str):
        return result

    health = result.get("data", [])
    if not health:
        return "No health data available."

    lines = ["Network Health:"]
    for h in health:
        subsystem = h.get("subsystem", "unknown")
        status = h.get("status", "unknown")
        num_adopted = h.get("num_adopted", "?")

        detail = ""
        if subsystem == "wan":
            rx = h.get("rx_bytes-r", 0)
            tx = h.get("tx_bytes-r", 0)
            detail = f" — ↓{rx // 1024}KB/s ↑{tx // 1024}KB/s"
        elif subsystem == "wlan":
            num_user = h.get("num_user", 0)
            detail = f" — {num_user} WiFi clients"
        elif subsystem == "lan":
            num_user = h.get("num_user", 0)
            detail = f" — {num_user} wired clients"

        lines.append(f"  {subsystem.upper()}: {status} ({num_adopted} devices){detail}")

    return "\n".join(lines)


@tool
async def unifi_alarms() -> str:
    """Check for active alarms/alerts on the UniFi network.

    Returns:
        List of active alarms or "No active alarms."
    """
    result = await _unifi_get("/s/default/stat/alarm")

    if isinstance(result, str):
        return result

    alarms = result.get("data", [])
    if not alarms:
        return "No active alarms."

    lines = [f"{len(alarms)} alarm(s):"]
    for a in alarms[:10]:
        msg = a.get("msg", "unknown alarm")
        ts = a.get("datetime", "")
        lines.append(f"  [{ts}] {msg}")

    return "\n".join(lines)


# Tool collection
UNIFI_TOOLS = [unifi_clients, unifi_devices, unifi_network_health, unifi_alarms]
