#!/usr/bin/env bash
#
# Deploy Mission Control to the VPS from a COMMITTED git ref — never the dirty
# working tree. This closes the drift hole where `docker compose up -d --build`
# was run against hand-applied, uncommitted edits, so the live image could not
# be traced back to any commit.
#
# How it stays safe:
#   * `git archive <ref>` exports ONLY the committed tree into a clean build dir,
#     so uncommitted/VPS-only edits are physically excluded from the image.
#   * `-p mission-control` pins the compose project name, so the SAME container
#     and the SAME data volume (mission-control_mc-data) are reused — the SQLite
#     DB is never orphaned by building from a different directory.
#   * Only gitignored runtime files (.env) are carried into the build context;
#     every tracked file (incl. docker-compose.override.yml) comes from the ref.
#   * The deployed SHA is recorded in .deployed-sha so git and the running
#     artifact can always be reconciled.
#
# Usage:
#   scripts/deploy-vps.sh [git-ref]      # default: origin/main
#
# Env overrides: MC_REPO_DIR (/opt/mission-control), MC_BUILD_DIR (/opt/mc-build)
#
set -euo pipefail

REPO_DIR="${MC_REPO_DIR:-/opt/mission-control}"
PROJECT="mission-control"          # MUST match the existing volume: mission-control_mc-data
REF="${1:-origin/main}"
RUNTIME_FILES=(.env)               # gitignored files to carry into the clean build context

cd "$REPO_DIR"
git fetch origin --quiet
SHA="$(git rev-parse --verify "${REF}^{commit}")"
SHORT="${SHA:0:9}"

BUILD_ROOT="${MC_BUILD_DIR:-/opt/mc-build}"
BUILD_DIR="${BUILD_ROOT}/${SHORT}"
echo "▶ Deploying ${PROJECT} @ ${REF} (${SHORT}) from the committed tree"

# Warn (do not block) if the live working tree carries uncommitted edits — they
# are intentionally NOT shipped, but the operator should know they exist.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠ working tree has uncommitted changes — they will NOT be deployed (building from ${SHORT}):"
  git --no-pager diff --stat | sed 's/^/    /'
fi

# Export ONLY the committed tree. The dirty working tree is never the build context.
rm -rf "$BUILD_DIR"; mkdir -p "$BUILD_DIR"
git archive "$SHA" | tar -x -C "$BUILD_DIR"

# Carry gitignored runtime files (secrets / local-only) into the build context.
for f in "${RUNTIME_FILES[@]}"; do
  if [ -f "$REPO_DIR/$f" ]; then
    mkdir -p "$BUILD_DIR/$(dirname "$f")"
    cp -a "$REPO_DIR/$f" "$BUILD_DIR/$f"
  else
    echo "  (runtime file $f not present — skipping)"
  fi
done

cd "$BUILD_DIR"
docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.override.yml up -d --build

# Record provenance so git and the running artifact never silently drift again.
echo "$SHA" > "$REPO_DIR/.deployed-sha"
printf 'deployed_at=%sZ ref=%s sha=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%S)" "$REF" "$SHA" >> "$REPO_DIR/.deploy-log"

# Health check (/ returns 307 → login redirect when healthy).
PORT_HOST="$(grep -E '^MC_PORT=' "$REPO_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
PORT_HOST="${PORT_HOST:-4000}"
sleep 6
curl -fsS -o /dev/null -w "✓ health: HTTP %{http_code} in %{time_total}s\n" "http://127.0.0.1:${PORT_HOST}/" \
  || echo "⚠ health check did not return 2xx/3xx — inspect: docker logs ${PROJECT}"

echo "✓ Deployed ${SHORT} (recorded in ${REPO_DIR}/.deployed-sha)"

# Keep only the 3 most recent build dirs.
ls -1dt "${BUILD_ROOT}"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf || true
