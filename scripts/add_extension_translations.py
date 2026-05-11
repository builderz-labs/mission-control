#!/usr/bin/env python3
"""Add oapApprovals + litellmUsage translation namespaces to src/extensions/i18n/en.json.

Idempotent: merges keys non-destructively. Source-of-truth file is the
fork-only extension i18n directory (#319), not upstream `messages/`."""

import json
from pathlib import Path

OAP_APPROVALS = {
    "title": "Approvals",
    "pendingBadge": "{count} pending",
    "refresh": "Refresh",
    "refreshing": "Refreshing…",
    "filtersAria": "Filter approvals by status",
    "filterAll": "All",
    "filterPending": "Pending",
    "filterResolved": "Resolved",
    "searchAria": "Search approvals",
    "searchPlaceholder": "Search decisions…",
    "selectAllVisible": "Select all visible",
    "selectRow": "Select row",
    "selectedCount": "{count} selected",
    "approve": "Approve",
    "approveAndAdd": "Approve + add",
    "approveAndAddHint": "Approves this decision and adds a rule for future similar requests.",
    "deny": "Deny",
    "bulkApprove": "Approve selected",
    "bulkDeny": "Deny selected",
    "clear": "Clear selection",
    "emptyAll": "No approvals on record.",
    "emptyPending": "No pending approvals. All clear.",
    "loadError": "Failed to load approvals",
    "retry": "Retry",
    "sidecarUnreachable": "OAP sidecar unreachable — check that the sidecar is running.",
    "statusApproved": "approved",
    "statusDenied": "denied",
    "showDetails": "Show details",
    "hideDetails": "Hide details",
    "toastActionFailed": "Action failed",
    "toastApproved": "Approved",
    "toastApprovedAndAdded": "Approved and rule added",
    "toastBulkDone": "{n, plural, one {# action applied} other {# actions applied}}",
    "toastDenied": "Denied",
}

LITELLM_USAGE = {
    "title": "LLM Usage & Cost",
    "refresh": "Refresh",
    "windowAria": "Time window",
    "totalCalls": "Total Calls",
    "totalCost": "Total Cost",
    "totalTokens": "Total Tokens",
    "avgLatency": "Avg Latency",
    "cacheHitRate": "Cache Hit Rate",
    "errorRate": "Error Rate",
    "successRate": "Success Rate",
    "costOverTime": "Cost & Calls Over Time",
    "byModel": "By Model",
    "byAgent": "By Agent",
    "byUser": "By User",
    "recentCalls": "Recent Calls",
    "searchAria": "Search calls",
    "searchPlaceholder": "Filter by model or agent…",
    "colModel": "Model",
    "colAgent": "Agent",
    "colCost": "Cost",
    "colCompletion": "Comp",
    "colPrompt": "Prompt",
    "colStatus": "Status",
    "colTime": "Time",
    "colLatency": "Latency",
    "colCalls": "Calls",
    "colTokens": "Tokens",
    "prev": "Prev",
    "next": "Next",
    "recordsCount": "{count} records",
    "loadingRecords": "Loading…",
    "loadError": "Failed to load usage data",
    "retry": "Retry",
    "empty": "No usage data for this window yet.",
    "emptyRecords": "No calls match this filter.",
}


def main():
    path = Path(__file__).resolve().parent.parent / "src" / "extensions" / "i18n" / "locales" / "en.json"
    data = json.loads(path.read_text(encoding="utf-8"))

    for ns, keys in [("oapApprovals", OAP_APPROVALS), ("litellmUsage", LITELLM_USAGE)]:
        existing = data.get(ns, {}) if isinstance(data.get(ns), dict) else {}
        merged = {**keys, **existing}  # preserve any pre-existing overrides
        data[ns] = merged

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Updated {path}")
    print(f"  oapApprovals: {len(data['oapApprovals'])} keys")
    print(f"  litellmUsage: {len(data['litellmUsage'])} keys")


if __name__ == "__main__":
    main()
