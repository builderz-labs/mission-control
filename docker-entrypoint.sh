#!/bin/sh
set -e

. /app/scripts/load-env.sh

# --- Load .env as literal configuration if present ---
if [ -f /app/.env ]; then
  printf '[entrypoint] Loading .env\n'
  load_env_file /app/.env
fi

# --- Helper: generate a random hex secret ---
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

DATA_DIR="${MISSION_CONTROL_DATA_DIR:-/app/.data}"
SECRETS_FILE="${DATA_DIR}/.generated-secrets"

# The Fly control plane mounts its durable SQLite data directory at /data.
# Fail before generating credentials if that mount is absent or read-only;
# starting with transient credentials would silently split the control plane.
if ! mkdir -p "$DATA_DIR" || ! touch "$SECRETS_FILE"; then
  printf '[entrypoint] Persistent data directory is not writable: %s\n' "$DATA_DIR" >&2
  exit 1
fi
if [ "$(id -u)" = "0" ]; then
  chown -R nextjs:nodejs "$DATA_DIR"
fi
chmod 600 "$SECRETS_FILE"

# Ensure secrets file has restrictive permissions if it exists
# Load previously generated secrets if they exist
if [ -f "$SECRETS_FILE" ]; then
  printf '[entrypoint] Loading persisted secrets\n'
  load_env_file "$SECRETS_FILE"
fi

# --- AUTH_SECRET ---
if [ -z "$AUTH_SECRET" ] || [ "$AUTH_SECRET" = "random-secret-for-legacy-cookies" ]; then
  AUTH_SECRET=$(generate_secret)
  printf '[entrypoint] Generated new AUTH_SECRET\n'
  printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET" >> "$SECRETS_FILE"
  export AUTH_SECRET
fi

# --- API_KEY ---
if [ -z "$API_KEY" ] || [ "$API_KEY" = "generate-a-random-key" ]; then
  API_KEY=$(generate_secret)
  printf '[entrypoint] Generated new API_KEY\n'
  printf 'API_KEY=%s\n' "$API_KEY" >> "$SECRETS_FILE"
  export API_KEY
fi

printf '[entrypoint] Starting server\n'
if [ "$(id -u)" = "0" ]; then
  exec gosu nextjs node server.js
fi
exec node server.js
