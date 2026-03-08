#!/usr/bin/env python3
"""
Seed Roy's board with initial tasks.
Run AFTER the roy/roy-board PR is merged and deployed.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from mc_board import add_task

DESK = [
    ("Fix MC auth: session invalidation on navigation", "high"),
    ("Fix DNC tally: 2 bad rows showing wrong count", "medium"),
    ("Change MC default home page to Pipeline", "low"),
]

BACKLOG = [
    ("More ws2 rounds: otter/GCN/DCO phrases", "medium"),
    ("EA Species Licence register integration", "medium"),
    ("Fix broken email templates rows 417/522/540", "low"),
    ("Cooloff re-entry 16 March: verify cron in place", "high"),
]

DONE = [
    ("Deploy Mission Control to Vercel", "high"),
    ("Run Monday WF E1+E2 sends", "high"),
    ("WF queue runway: 392 Queued achieved", "high"),
    ("CRM schema audit: all violations fixed", "medium"),
]

if __name__ == "__main__":
    print("Seeding Roy's Board...")
    for title, priority in DESK:
        add_task(title, column="desk", priority=priority, source="roy")
    for title, priority in BACKLOG:
        add_task(title, column="backlog", priority=priority, source="roy")
    for title, priority in DONE:
        add_task(title, column="done", priority=priority, source="roy")
    print("\nDone! Run `python3 scripts/mc_board.py list` to verify.")
