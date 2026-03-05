#!/usr/bin/env bash
# verify-openclaw-cli.sh
#
# Manual verification commands to confirm correct OpenClaw CLI usage.
# Run these after deploying Mission Control to verify gateway integration.
#
# Reference: https://docs.openclaw.ai/cli/gateway.md
# Reference: https://docs.openclaw.ai/cli/agents.md

set -euo pipefail

OPENCLAW_CMD="${OPENCLAW_CMD:-openclaw}"

echo "=== OpenClaw CLI Integration Verification ==="
echo ""

# 1. Check openclaw version
echo "[1] openclaw --version"
"$OPENCLAW_CMD" --version || echo "FAIL: could not run openclaw"
echo ""

# 2. Check gateway health (correct form)
echo "[2] Gateway health check (openclaw gateway health)"
"$OPENCLAW_CMD" gateway health || echo "FAIL or gateway not running — expected if gateway is offline"
echo ""

# 3. Gateway call status — correct RPC form
# Correct: openclaw gateway call <method>
# WRONG:   openclaw gateway sessions_send --session ... --message ...  (does not exist)
echo "[3] Gateway RPC call: status"
"$OPENCLAW_CMD" gateway call status || echo "FAIL: gateway call failed"
echo ""

# 4. sessions.send RPC — correct form
# Per docs: openclaw gateway call sessions.send --params '{"session":"<key>","message":"<text>"}'
echo "[4] Gateway RPC: sessions.send (dry-run, using fake session key)"
echo "    Command would be:"
echo "    $OPENCLAW_CMD gateway call sessions.send --params '{\"session\":\"agent:main:main\",\"message\":\"test\"}'"
echo "    (skipped in verify script — needs live gateway + valid session key)"
echo ""

# 5. agents add — correct positional form (no --name flag)
# Per docs: openclaw agents add <id> --workspace <path>
echo "[5] openclaw agents add (help)"
"$OPENCLAW_CMD" agents --help 2>&1 | head -20 || echo "FAIL"
echo ""

echo "=== Verification complete ==="
echo ""
echo "Manual check: confirm these commands FAIL (they are NOT valid):"
echo "  $OPENCLAW_CMD gateway sessions_send --session foo --message bar  # WRONG: subcommand doesn't exist"
echo "  $OPENCLAW_CMD agents add --name foo                               # WRONG: use positional: agents add foo"
