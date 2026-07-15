#!/usr/bin/env python3
"""Fail when a workflow executes a remote action through a mutable ref."""

from __future__ import annotations

import re
import sys
from pathlib import Path


WORKFLOW_DIR = Path(".github/workflows")
USES_PATTERN = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)", re.MULTILINE)
PIN_PATTERN = re.compile(r"^[^@\s]+@[0-9a-f]{40}$")


def main() -> int:
    failures: list[str] = []
    checked = 0

    for workflow in sorted((*WORKFLOW_DIR.glob("*.yml"), *WORKFLOW_DIR.glob("*.yaml"))):
        content = workflow.read_text(encoding="utf-8")
        for match in USES_PATTERN.finditer(content):
            reference = match.group(1)
            if reference.startswith("./"):
                continue
            checked += 1
            if not PIN_PATTERN.fullmatch(reference):
                line = content.count("\n", 0, match.start()) + 1
                failures.append(f"{workflow}:{line}: mutable action reference: {reference}")

    if failures:
        print("Workflow action pin check failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(f"Workflow action pin check passed ({checked} remote references)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
