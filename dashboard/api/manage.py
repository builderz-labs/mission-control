#!/usr/bin/env python3
"""
Signal Service CLI — Manage agents and pairing tokens.

Usage:
    python3 manage.py add-user <user_id> <display_name>
    python3 manage.py list-users
    python3 manage.py revoke-user <user_id>
"""

import sys
import os

# Ensure signal_service is importable
sys.path.insert(0, os.path.dirname(__file__))

# Load .env for TRADING_DB_PATH
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

from signal_service.auth import generate_pairing_token
from signal_service.db import (
    init_signal_tables, create_pairing_token, list_agents, revoke_agent,
)


def cmd_add_user(user_id: str, display_name: str):
    """Generate a pairing token for a new user."""
    init_signal_tables()
    token = generate_pairing_token()
    create_pairing_token(token, user_id, display_name)

    print(f"\nPairing token generated for '{display_name}' ({user_id}):\n")
    print(f"  {token}\n")
    print("Send this token to the user. It expires in 48 hours and is single-use.")
    print("They will enter it in the ICT Agent setup wizard.\n")


def cmd_list_users():
    """List all registered agents."""
    init_signal_tables()
    agents = list_agents()

    if not agents:
        print("No agents registered.")
        return

    print(f"\n{'User ID':<15} {'Name':<20} {'Active':<8} {'Last Seen':<25} {'Host':<15} {'Version'}")
    print("-" * 100)
    for a in agents:
        active = "YES" if a["active"] else "REVOKED"
        last = (a.get("last_seen") or "never")[:19]
        host = a.get("hostname") or "-"
        ver = a.get("agent_version") or "-"
        print(f"{a['user_id']:<15} {a['display_name']:<20} {active:<8} {last:<25} {host:<15} {ver}")
    print()


def cmd_revoke_user(user_id: str):
    """Revoke an agent's access."""
    init_signal_tables()
    revoke_agent(user_id)
    print(f"Agent '{user_id}' has been revoked. Their next connection will be rejected.")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "add-user":
        if len(sys.argv) < 4:
            print("Usage: python3 manage.py add-user <user_id> <display_name>")
            sys.exit(1)
        cmd_add_user(sys.argv[2], " ".join(sys.argv[3:]))

    elif cmd == "list-users":
        cmd_list_users()

    elif cmd == "revoke-user":
        if len(sys.argv) < 3:
            print("Usage: python3 manage.py revoke-user <user_id>")
            sys.exit(1)
        cmd_revoke_user(sys.argv[2])

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
