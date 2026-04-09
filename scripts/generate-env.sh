#!/usr/bin/env bash
# Generate a secure .env file from .env.example with random secrets.
# Usage: bash scripts/generate-env.sh [output-path]
#
# If output-path is omitted, writes to .env in the project root.
# Will NOT overwrite an existing .env unless --force is passed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLE_FILE="$PROJECT_ROOT/.env.example"
FORCE=false
OUTPUT=""

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    *) OUTPUT="$arg" ;;
  esac
done

OUTPUT="${OUTPUT:-$PROJECT_ROOT/.env}"

if [[ -f "$OUTPUT" ]] && ! $FORCE; then
  echo "Error: $OUTPUT already exists. Use --force to overwrite."
  exit 1
fi

if [[ ! -f "$EXAMPLE_FILE" ]]; then
  echo "Error: .env.example not found at $EXAMPLE_FILE"
  exit 1
fi

# Generate cryptographically random values
generate_password() {
  local len="${1:-24}"
  # Use openssl if available, fallback to /dev/urandom
  if command -v openssl &>/dev/null; then
    openssl rand -base64 "$((len * 3 / 4 + 1))" | tr -dc 'A-Za-z0-9' | head -c "$len"
  else
    head -c "$((len * 2))" /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c "$len"
  fi
}

generate_hex() {
  local len="${1:-32}"
  if command -v openssl &>/dev/null; then
    openssl rand -hex "$((len / 2))"
  else
    head -c "$((len / 2))" /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "$len"
  fi
}

AUTH_PASS="$(generate_password 24)"
API_KEY="$(generate_hex 32)"
AUTH_SECRET="$(generate_password 32)"

# Copy .env.example and replace default secrets
cp "$EXAMPLE_FILE" "$OUTPUT"

# Escape sed replacement metacharacters (|, &, \) in a value.
# Does not handle newlines — callers must ensure single-line input.
sed_escape() { printf '%s' "$1" | sed 's/[|&\\]/\\&/g'; }

portable_sed() {
  local pattern="$1" file="$2"
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "$pattern" "$file"
  else
    sed -i "$pattern" "$file"
  fi
}

# Replace the insecure defaults with generated values
portable_sed "s|^AUTH_PASS=.*|AUTH_PASS=$(sed_escape "$AUTH_PASS")|" "$OUTPUT"
portable_sed "s|^API_KEY=.*|API_KEY=$(sed_escape "$API_KEY")|" "$OUTPUT"
portable_sed "s|^AUTH_SECRET=.*|AUTH_SECRET=$(sed_escape "$AUTH_SECRET")|" "$OUTPUT"

# Lock down permissions
chmod 600 "$OUTPUT"

echo "Generated secure .env at $OUTPUT"
echo "  AUTH_USER: admin"
echo "  AUTH_PASS: $AUTH_PASS"
echo "  API_KEY:   $API_KEY"
echo ""
echo "Save these credentials — they are not stored elsewhere."
