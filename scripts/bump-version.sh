#!/usr/bin/env bash
# Bump /VERSION using semver, commit, tag.
#
# Usage:
#   scripts/bump-version.sh patch     # 3.6.0 -> 3.6.1
#   scripts/bump-version.sh minor     # 3.6.0 -> 3.7.0
#   scripts/bump-version.sh major     # 3.6.0 -> 4.0.0
#   scripts/bump-version.sh --push    # also push commit + tag to origin
#
# Refuses to run with a dirty working tree (commit your changes first).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION_FILE="${REPO_ROOT}/VERSION"

PUSH=0
PART=""
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    patch|minor|major) PART="$arg" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "ERROR: unknown arg '$arg'" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PART" ]]; then
  echo "ERROR: must specify patch | minor | major" >&2
  exit 2
fi

cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree dirty — commit or stash first" >&2
  git status --short >&2
  exit 1
fi

CURRENT="$(cat "$VERSION_FILE")"
IFS='.' read -r MAJ MIN PAT <<< "$CURRENT"

case "$PART" in
  major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
  minor) MIN=$((MIN + 1)); PAT=0 ;;
  patch) PAT=$((PAT + 1)) ;;
esac

NEW="${MAJ}.${MIN}.${PAT}"
echo "$NEW" > "$VERSION_FILE"

git add "$VERSION_FILE"
git commit -m "chore: bump version to ${NEW}"
git tag "v${NEW}"

echo "Bumped: ${CURRENT} -> ${NEW}"
echo "Tagged: v${NEW}"

if [[ "$PUSH" == "1" ]]; then
  git push origin main --tags
  echo "Pushed to origin."
else
  echo "Run 'git push origin main --tags' to publish."
fi
