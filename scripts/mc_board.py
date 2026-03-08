#!/usr/bin/env python3
"""
Roy's Mission Control board updater.
Usage:
  python3 scripts/mc_board.py list
  python3 scripts/mc_board.py add --title "..." --column desk --priority high --source roy
  python3 scripts/mc_board.py move <task_id> <column>   # column = backlog|desk|done
  python3 scripts/mc_board.py done <task_id>
  python3 scripts/mc_board.py delete <task_id>
"""
import os, sys, json, argparse, requests
from datetime import datetime

MC_URL = os.environ.get("MC_URL", "https://mission-control-gamma-lime.vercel.app")
MC_API_KEY = os.environ.get("MC_API_KEY", "9e11322f0bc1bfcdea2ef669870d001b7205ddba")
HEADERS = {"x-api-key": MC_API_KEY, "Content-Type": "application/json"}

def list_tasks():
    r = requests.get(f"{MC_URL}/api/wildform/board", headers=HEADERS)
    r.raise_for_status()
    tasks = r.json().get("tasks", [])
    for col in ["backlog", "desk", "done"]:
        col_tasks = [t for t in tasks if t["column"] == col]
        print(f"\n=== {col.upper()} ({len(col_tasks)}) ===")
        for t in col_tasks:
            print(f"  [{t['id'][:8]}] {t['title']} [{t['priority']}] ({t['source']})")

def add_task(title, column="backlog", priority="medium", source="roy", description=None):
    payload = {"title": title, "column": column, "priority": priority, "source": source}
    if description:
        payload["description"] = description
    r = requests.post(f"{MC_URL}/api/wildform/board", headers=HEADERS, json=payload)
    r.raise_for_status()
    task = r.json().get("task", {})
    print(f"Created: [{task.get('id','')[:8]}] {task.get('title','')}")
    return task

def move_task(task_id, column):
    payload = {"id": task_id, "column": column}
    r = requests.put(f"{MC_URL}/api/wildform/board", headers=HEADERS, json=payload)
    r.raise_for_status()
    print(f"Moved {task_id[:8]} -> {column}")

def delete_task(task_id):
    r = requests.delete(f"{MC_URL}/api/wildform/board?id={task_id}", headers=HEADERS)
    r.raise_for_status()
    print(f"Deleted {task_id[:8]}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="cmd")
    subparsers.add_parser("list")
    p_add = subparsers.add_parser("add")
    p_add.add_argument("--title", required=True)
    p_add.add_argument("--column", default="backlog")
    p_add.add_argument("--priority", default="medium")
    p_add.add_argument("--source", default="roy")
    p_add.add_argument("--description", default=None)
    p_move = subparsers.add_parser("move")
    p_move.add_argument("task_id")
    p_move.add_argument("column")
    p_done = subparsers.add_parser("done")
    p_done.add_argument("task_id")
    p_del = subparsers.add_parser("delete")
    p_del.add_argument("task_id")
    args = parser.parse_args()

    if args.cmd == "list":
        list_tasks()
    elif args.cmd == "add":
        add_task(args.title, args.column, args.priority, args.source, args.description)
    elif args.cmd in ("move", "done"):
        col = "done" if args.cmd == "done" else args.column
        move_task(args.task_id, col)
    elif args.cmd == "delete":
        delete_task(args.task_id)
    else:
        parser.print_help()
