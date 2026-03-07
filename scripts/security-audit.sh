#!/usr/bin/env bash
# Mission Control Security Audit
# Run: bash scripts/security-audit.sh [--env-file .env]

set -euo pipefail

SCORE=0
MAX_SCORE=0
ISSUES=()

pass() { echo "  [PASS] $1"; ((SCORE++)); ((MAX_SCORE++)); }
fail() { echo "  [FAIL] $1"; ISSUES+=("$1"); ((MAX_SCORE++)); }
warn() { echo "  [WARN] $1"; ((MAX_SCORE++)); }
info() { echo "  [INFO] $1"; }

# Load .env if exists
ENV_FILE="${1:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^#.*$ ]] && continue
    [[ -z "$key" ]] && continue
    declare "$key=$value" 2>/dev/null || true
  done < "$ENV_FILE"
fi

echo "=== Mission Control Security Audit ==="
echo ""

# 1. .env file permissions
echo "--- File Permissions ---"
if [[ -f "$ENV_FILE" ]]; then
  perms=$(stat -f '%A' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE" 2>/dev/null)
  if [[ "$perms" == "600" ]]; then
    pass ".env permissions are 600 (owner read/write only)"
  else
    fail ".env permissions are $perms (should be 600). Run: chmod 600 $ENV_FILE"
  fi
else
  warn ".env file not found at $ENV_FILE"
fi

# 2. Default passwords check
echo ""
echo "--- Credentials ---"
INSECURE_PASSWORDS=("admin" "password" "change-me-on-first-login" "changeme" "testpass123" "testpass1234")
AUTH_PASS_VAL="${AUTH_PASS:-}"
if [[ -z "$AUTH_PASS_VAL" ]]; then
  fail "AUTH_PASS is not set"
else
  insecure=false
  for bad in "${INSECURE_PASSWORDS[@]}"; do
    if [[ "$AUTH_PASS_VAL" == "$bad" ]]; then
      insecure=true; break
    fi
  done
  if $insecure; then
    fail "AUTH_PASS is set to a known insecure default"
  elif [[ ${#AUTH_PASS_VAL} -lt 12 ]]; then
    fail "AUTH_PASS is too short (${#AUTH_PASS_VAL} chars, minimum 12)"
  else
    pass "AUTH_PASS is set to a non-default value (${#AUTH_PASS_VAL} chars)"
  fi
fi

API_KEY_VAL="${API_KEY:-}"
if [[ -z "$API_KEY_VAL" || "$API_KEY_VAL" == "generate-a-random-key" ]]; then
  fail "API_KEY is not set or uses the default value"
else
  pass "API_KEY is configured"
fi

# 3. Network config
echo ""
echo "--- Network Security ---"
MC_ALLOWED="${MC_ALLOWED_HOSTS:-}"
MC_ANY="${MC_ALLOW_ANY_HOST:-}"
if [[ "$MC_ANY" == "1" || "$MC_ANY" == "true" ]]; then
  fail "MC_ALLOW_ANY_HOST is enabled (any host can connect)"
elif [[ -n "$MC_ALLOWED" ]]; then
  pass "MC_ALLOWED_HOSTS is configured: $MC_ALLOWED"
else
  warn "MC_ALLOWED_HOSTS is not set (defaults apply)"
fi

# 4. Cookie/HTTPS config
echo ""
echo "--- HTTPS & Cookies ---"
COOKIE_SECURE="${MC_COOKIE_SECURE:-}"
if [[ "$COOKIE_SECURE" == "1" || "$COOKIE_SECURE" == "true" ]]; then
  pass "MC_COOKIE_SECURE is enabled"
else
  warn "MC_COOKIE_SECURE is not enabled (cookies sent over HTTP)"
fi

SAMESITE="${MC_COOKIE_SAMESITE:-strict}"
if [[ "$SAMESITE" == "strict" ]]; then
  pass "MC_COOKIE_SAMESITE is strict"
else
  warn "MC_COOKIE_SAMESITE is '$SAMESITE' (strict recommended)"
fi

HSTS="${MC_ENABLE_HSTS:-}"
if [[ "$HSTS" == "1" ]]; then
  pass "HSTS is enabled"
else
  warn "HSTS is not enabled (set MC_ENABLE_HSTS=1 for HTTPS deployments)"
fi

# 5. Rate limiting
echo ""
echo "--- Rate Limiting ---"
RL_DISABLED="${MC_DISABLE_RATE_LIMIT:-}"
if [[ "$RL_DISABLED" == "1" ]]; then
  fail "Rate limiting is disabled (MC_DISABLE_RATE_LIMIT=1)"
else
  pass "Rate limiting is active"
fi

# 6. Docker security (if running in Docker)
echo ""
echo "--- Docker Security ---"
if command -v docker &>/dev/null; then
  if docker ps --filter name=mission-control --format '{{.Names}}' 2>/dev/null | grep -q mission-control; then
    ro=$(docker inspect mission-control --format '{{.HostConfig.ReadonlyRootfs}}' 2>/dev/null || echo "false")
    if [[ "$ro" == "true" ]]; then
      pass "Container filesystem is read-only"
    else
      warn "Container filesystem is writable (use read_only: true)"
    fi

    nnp=$(docker inspect mission-control --format '{{.HostConfig.SecurityOpt}}' 2>/dev/null || echo "[]")
    if echo "$nnp" | grep -q "no-new-privileges"; then
      pass "no-new-privileges is set"
    else
      warn "no-new-privileges not set"
    fi

    user=$(docker inspect mission-control --format '{{.Config.User}}' 2>/dev/null || echo "")
    if [[ -n "$user" && "$user" != "root" && "$user" != "0" ]]; then
      pass "Container runs as non-root user ($user)"
    else
      warn "Container may be running as root"
    fi
  else
    info "Mission Control container not running"
  fi
else
  info "Docker not installed (skipping container checks)"
fi

# Summary
echo ""
echo "=== Security Score: $SCORE / $MAX_SCORE ==="
if [[ ${#ISSUES[@]} -gt 0 ]]; then
  echo ""
  echo "Issues to fix:"
  for issue in "${ISSUES[@]}"; do
    echo "  - $issue"
  done
fi

if [[ $SCORE -eq $MAX_SCORE ]]; then
  echo "All checks passed!"
elif [[ $SCORE -ge $((MAX_SCORE * 7 / 10)) ]]; then
  echo "Good security posture with minor improvements needed."
else
  echo "Security improvements recommended before production use."
fi
