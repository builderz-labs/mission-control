"""
Tradovate credential seeder — run once when you have your API add-on credentials.

Writes credentials to trading_accounts for account 'ross'.
Reads from stdin so nothing lands in shell history.

Usage:
    cd /opt/trading-workspace/trading
    python3 execution/seed_credentials.py          # store creds only
    python3 execution/seed_credentials.py --live   # also set mode=live
"""
import json
import sys
import os
import sqlite3
import getpass
from datetime import datetime, timezone

DB_PATH = os.environ.get("TRADING_DB_PATH", "/opt/trading-workspace/trading/data/trading.db")


def main():
    go_live = "--live" in sys.argv

    print("Tradovate Credential Setup")
    print("=" * 40)
    print("Credentials are stored in the trading DB only — not in any .env file.")
    print()

    username = input("Tradovate username (email): ").strip()
    password = getpass.getpass("Tradovate password: ")
    cid      = input("API client ID (cid, from $25/mo add-on): ").strip()
    sec      = getpass.getpass("API secret (sec): ")

    if not all([username, password, cid, sec]):
        print("ERROR: All four fields are required.")
        sys.exit(1)

    creds = json.dumps({
        "username": username,
        "password": password,
        "cid":      int(cid) if cid.isdigit() else cid,
        "sec":      sec,
    })

    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(DB_PATH)

    existing = conn.execute("SELECT id FROM trading_accounts WHERE id='ross'").fetchone()
    if existing:
        conn.execute(
            "UPDATE trading_accounts SET credentials=?, updated_at=? WHERE id='ross'",
            (creds, now)
        )
    else:
        conn.execute(
            "INSERT INTO trading_accounts (id, name, broker, mode, credentials, active, created_at, updated_at) "
            "VALUES ('ross','Ross Hickey','tradovate','paper',?,1,?,?)",
            (creds, now, now)
        )

    if go_live:
        conn.execute("UPDATE trading_accounts SET mode='live', updated_at=? WHERE id='ross'", (now,))
        print()
        print("Mode set to LIVE — next signal will place real orders.")
    else:
        print()
        print("Mode is PAPER — credentials stored but live execution not yet active.")
        print("Run with --live when ready to go live.")

    conn.commit()
    conn.close()

    print()
    print("Done. Verify with:")
    print("  python3 execution/test_auth.py")


if __name__ == "__main__":
    main()
