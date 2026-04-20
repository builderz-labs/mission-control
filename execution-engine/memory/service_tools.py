"""Service integration tools — connect RoceOS to external services.

Each tool wraps a REST API with proper auth. API keys stored in config.
"""
import json
import logging

import httpx
from langchain_core.tools import tool

from config import settings

logger = logging.getLogger("roceos.services")


# ── GitHub ──

@tool
async def github_list_repos() -> str:
    """List all GitHub repositories for spaceghostroce.

    Returns:
        List of repos with name, description, visibility, and last updated.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        headers = {}
        if settings.github_token:
            headers["Authorization"] = f"token {settings.github_token}"

        resp = await client.get(
            "https://api.github.com/user/repos?per_page=30&sort=updated",
            headers=headers,
        )

        if resp.status_code != 200:
            return f"GitHub API error: {resp.status_code} {resp.text[:200]}"

        repos = resp.json()
        lines = []
        for r in repos:
            vis = "private" if r.get("private") else "public"
            desc = r.get("description") or "no description"
            lines.append(f"- {r['name']} ({vis}) — {desc}")

        return "\n".join(lines) if lines else "No repos found."


@tool
async def github_repo_info(repo: str) -> str:
    """Get detailed info about a specific GitHub repository.

    Args:
        repo: Repository name (e.g., "roce-os", "trading-system")

    Returns:
        Repo details including branches, recent commits, open issues/PRs.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        headers = {}
        if settings.github_token:
            headers["Authorization"] = f"token {settings.github_token}"

        base = f"https://api.github.com/repos/spaceghostroce/{repo}"

        # Get repo info
        resp = await client.get(base, headers=headers)
        if resp.status_code != 200:
            return f"Repo not found or error: {resp.status_code}"

        info = resp.json()

        # Get recent commits
        commits_resp = await client.get(f"{base}/commits?per_page=5", headers=headers)
        commits = commits_resp.json() if commits_resp.status_code == 200 else []

        output = [
            f"Repository: {info['full_name']}",
            f"Description: {info.get('description') or 'none'}",
            f"Default branch: {info['default_branch']}",
            f"Visibility: {'private' if info['private'] else 'public'}",
            f"Open issues: {info.get('open_issues_count', 0)}",
            f"Last push: {info.get('pushed_at', 'unknown')}",
            "",
            "Recent commits:",
        ]

        for c in commits[:5]:
            msg = c.get("commit", {}).get("message", "").split("\n")[0]
            sha = c.get("sha", "")[:7]
            output.append(f"  {sha} — {msg}")

        return "\n".join(output)


# ── Alpaca Trading ──

@tool
async def alpaca_account_status(account: str = "live") -> str:
    """Get Alpaca trading account status and portfolio value.

    Args:
        account: "live" or "paper"

    Returns:
        Account equity, buying power, P&L, and status.
    """
    if account == "paper":
        base_url = "https://paper-api.alpaca.markets"
        api_key = settings.alpaca_paper_key
        secret = settings.alpaca_paper_secret
    else:
        base_url = "https://api.alpaca.markets"
        api_key = settings.alpaca_live_key
        secret = settings.alpaca_live_secret

    if not api_key:
        return f"Alpaca {account} API key not configured."

    async with httpx.AsyncClient(timeout=15.0) as client:
        headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret,
        }

        resp = await client.get(f"{base_url}/v2/account", headers=headers)
        if resp.status_code != 200:
            return f"Alpaca API error: {resp.status_code} {resp.text[:200]}"

        acct = resp.json()
        return (
            f"Alpaca {account.upper()} Account:\n"
            f"  Status: {acct.get('status')}\n"
            f"  Equity: ${float(acct.get('equity', 0)):,.2f}\n"
            f"  Cash: ${float(acct.get('cash', 0)):,.2f}\n"
            f"  Buying Power: ${float(acct.get('buying_power', 0)):,.2f}\n"
            f"  Portfolio Value: ${float(acct.get('portfolio_value', 0)):,.2f}\n"
            f"  Daily P&L: ${float(acct.get('equity', 0)) - float(acct.get('last_equity', 0)):,.2f}"
        )


@tool
async def alpaca_positions(account: str = "live") -> str:
    """List current open positions in Alpaca trading account.

    Args:
        account: "live" or "paper"

    Returns:
        List of open positions with symbol, qty, P&L.
    """
    if account == "paper":
        base_url = "https://paper-api.alpaca.markets"
        api_key = settings.alpaca_paper_key
        secret = settings.alpaca_paper_secret
    else:
        base_url = "https://api.alpaca.markets"
        api_key = settings.alpaca_live_key
        secret = settings.alpaca_live_secret

    if not api_key:
        return f"Alpaca {account} API key not configured."

    async with httpx.AsyncClient(timeout=15.0) as client:
        headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret,
        }

        resp = await client.get(f"{base_url}/v2/positions", headers=headers)
        if resp.status_code != 200:
            return f"Alpaca API error: {resp.status_code}"

        positions = resp.json()
        if not positions:
            return f"No open positions in {account} account."

        lines = [f"Open positions ({account}):"]
        for p in positions:
            pnl = float(p.get("unrealized_pl", 0))
            pnl_pct = float(p.get("unrealized_plpc", 0)) * 100
            lines.append(
                f"  {p['symbol']}: {p['qty']} shares @ ${float(p['avg_entry_price']):,.2f} "
                f"(P&L: ${pnl:,.2f} / {pnl_pct:+.1f}%)"
            )

        return "\n".join(lines)


# ── Tool Collections ──

GITHUB_TOOLS = [github_list_repos, github_repo_info]
TRADING_TOOLS = [alpaca_account_status, alpaca_positions]
SERVICE_TOOLS = GITHUB_TOOLS + TRADING_TOOLS
