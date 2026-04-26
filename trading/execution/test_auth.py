"""
Tradovate credential test — run this before going live.

Tests authentication against the DEMO API only. No orders are placed.
Prints account info and cash balance to confirm credentials work.

Usage:
    cd /opt/trading-workspace/trading
    python3 execution/test_auth.py
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from execution.tradovate import TradovateClient
import sqlite3

DB_PATH = os.environ.get("TRADING_DB_PATH", "/opt/trading-workspace/trading/data/trading.db")


def load_credentials(account_id="ross"):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT credentials, mode FROM trading_accounts WHERE id=?", (account_id,)
    ).fetchone()
    conn.close()
    if not row or not row[0]:
        return None, None
    return json.loads(row[0]), row[1]


def main():
    creds, mode = load_credentials()
    if not creds:
        print("ERROR: No credentials found for account 'ross'.")
        print()
        print("Seed credentials first:")
        print("  python3 execution/seed_credentials.py")
        sys.exit(1)

    print(f"Testing credentials for user: {creds.get('username')}")
    print(f"Account mode in DB: {mode}")
    print("Connecting to DEMO API (no real orders)...")
    print()

    client = TradovateClient(
        username=creds["username"],
        password=creds["password"],
        cid=creds["cid"],
        sec=creds["sec"],
        live=False,  # ALWAYS demo for this test
    )

    ok = client.authenticate()
    if not ok:
        print("FAIL: Authentication failed. Check username/password/cid/sec.")
        sys.exit(1)

    print(f"OK: Authenticated. User ID: {client.user_id}")
    print(f"OK: Account ID: {client.account_id}")

    accounts = client.get_accounts()
    for a in accounts:
        print(f"    Account: {a.get('name')} (id={a.get('id')}, active={a.get('active')})")

    balance = client.get_cash_balance()
    print(f"OK: Cash balance: {balance}")

    positions = client.get_positions()
    print(f"OK: Open positions: {len(positions) if isinstance(positions, list) else positions}")

    print()
    print("All checks passed. Credentials are valid.")
    print()
    print("To enable live trading, run:")
    print("  python3 execution/seed_credentials.py --live")


if __name__ == "__main__":
    main()
