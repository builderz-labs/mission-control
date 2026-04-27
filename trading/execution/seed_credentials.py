"""
Tradovate credential seeder — run once when you have your API add-on credentials.

Writes credentials to trading_accounts for account 'ross'.
Reads from stdin so nothing lands in shell history.

Usage:
    cd /opt/trading-workspace/trading
    python3 execution/seed_credentials.py          # store creds, stay paper
    python3 execution/seed_credentials.py --demo   # rehearsal: live routing → demo endpoint
    python3 execution/seed_credentials.py --live   # full live: live routing → live endpoint

Modes:
  (default) mode=paper      Logs to DB only. No Tradovate API calls at all.
  --demo    mode=live        Routes through the live execution path but connects
                             to demo.tradovateapi.com. Orders are simulated.
                             Use to verify the bracket order format before real money.
  --live    mode=live        Full live: real orders on live.tradovateapi.com.
"""
import json
import sys
import os
import sqlite3
import getpass
from datetime import datetime, timezone

DB_PATH = os.environ.get("TRADING_DB_PATH", "/opt/trading-workspace/trading/data/trading.db")


def main():
    go_live  = "--live"  in sys.argv
    go_demo  = "--demo"  in sys.argv

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

    # live_mode=True  → connects to live.tradovateapi.com (real money)
    # live_mode=False → connects to demo.tradovateapi.com (simulated orders)
    live_mode = go_live and not go_demo

    creds = json.dumps({
        "username":  username,
        "password":  password,
        "cid":       int(cid) if cid.isdigit() else cid,
        "sec":       sec,
        "live_mode": live_mode,
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
        if live_mode:
            print()
            print("Mode set to LIVE → live.tradovateapi.com — next signal places REAL orders.")
        else:
            print()
            print("Mode set to LIVE → demo.tradovateapi.com (rehearsal). Orders are simulated.")
            print("Run with --live (not --demo) when ready for real money.")
    else:
        print()
        print("Mode is PAPER — credentials stored but live execution not yet active.")
        print()
        print("Next steps:")
        print("  1. python3 execution/test_auth.py        — verify credentials against demo")
        print("  2. python3 execution/seed_credentials.py --demo  — rehearsal with demo orders")
        print("  3. python3 execution/seed_credentials.py --live  — go live (real money)")

    conn.commit()
    conn.close()

    print()
    print("Done. Verify credentials:")
    print("  python3 execution/test_auth.py")


if __name__ == "__main__":
    main()
