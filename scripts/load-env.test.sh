#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOADER="$ROOT_DIR/scripts/load-env.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mc-load-env.XXXXXX")"
SAFE_ENV="$TMP_DIR/safe.env"
OVERRIDE_ENV="$TMP_DIR/override.env"
UNSAFE_ENV="$TMP_DIR/unsafe.env"
INVALID_ENV="$TMP_DIR/invalid.env"
MARKER="$TMP_DIR/executed"

cleanup() {
  rm -f "$SAFE_ENV" "$OVERRIDE_ENV" "$UNSAFE_ENV" "$INVALID_ENV" "$MARKER"
  rmdir "$TMP_DIR"
}
trap cleanup EXIT

cat > "$SAFE_ENV" <<EOF
# Values are data, not shell syntax.
AUTH_PASS='\$(touch "$MARKER")'
API_KEY="literal # value"
MC_ALLOWED_HOSTS=127.0.0.1,localhost
MC_COOKIE_SECURE=1 # inline documentation is not part of the value
EMPTY_VALUE=
EOF

result="$(sh -c '. "$1"; load_env_file "$2"; printf "%s\n%s\n%s\n%s" "$AUTH_PASS" "$API_KEY" "$MC_COOKIE_SECURE" "$EMPTY_VALUE"' _ "$LOADER" "$SAFE_ENV")"
expected="$(printf '%s\n%s\n%s\n%s' "\$(touch \"$MARKER\")" 'literal # value' '1' '')"
[[ "$result" == "$expected" ]]
[[ ! -e "$MARKER" ]]

cat > "$OVERRIDE_ENV" <<'EOF'
AUTH_PASS=overridden-literal
EOF
result="$(sh -c '. "$1"; load_env_file "$2"; load_env_file "$3"; printf "%s" "$AUTH_PASS"' _ "$LOADER" "$SAFE_ENV" "$OVERRIDE_ENV")"
[[ "$result" == 'overridden-literal' ]]

cat > "$UNSAFE_ENV" <<'EOF'
PATH=/tmp/untrusted-bin
EOF
if sh -c '. "$1"; load_env_file "$2"' _ "$LOADER" "$UNSAFE_ENV" >/dev/null 2>&1; then
  echo 'Expected process-control variables to be rejected' >&2
  exit 1
fi

cat > "$INVALID_ENV" <<'EOF'
mc_env_line_number=1+1
EOF
if sh -c '. "$1"; load_env_file "$2"' _ "$LOADER" "$INVALID_ENV" >/dev/null 2>&1; then
  echo 'Expected loader-internal variable names to be rejected' >&2
  exit 1
fi

cat > "$INVALID_ENV" <<'EOF'
INVALID-NAME=value
EOF
if sh -c '. "$1"; load_env_file "$2"' _ "$LOADER" "$INVALID_ENV" >/dev/null 2>&1; then
  echo 'Expected malformed variable names to be rejected' >&2
  exit 1
fi

echo 'load-env tests passed'
