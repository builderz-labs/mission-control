#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Install (or upgrade) the obsidian-marp community plugin into the Ultron
# wiki vault's .obsidian/plugins directory.
#
# Run once after cloning, or to upgrade the plugin:
#   bash scripts/install-obsidian-marp.sh
# ---------------------------------------------------------------------------
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/wiki/.obsidian/plugins/obsidian-marp"
REPO="JichouP/obsidian-marp"

echo "📦  Fetching latest obsidian-marp release..."
TAG=$(curl -sf "https://api.github.com/repos/$REPO/releases/latest" \
      | grep '"tag_name"' | head -1 | cut -d'"' -f4)

if [[ -z "$TAG" ]]; then
  echo "❌  Could not reach GitHub API. Check your internet connection."
  exit 1
fi

echo "   Tag: $TAG"
BASE="https://github.com/$REPO/releases/download/$TAG"

mkdir -p "$PLUGIN_DIR"
curl -sfL "$BASE/main.js"      -o "$PLUGIN_DIR/main.js"
curl -sfL "$BASE/manifest.json" -o "$PLUGIN_DIR/manifest.json"
curl -sfL "$BASE/styles.css"   -o "$PLUGIN_DIR/styles.css" 2>/dev/null || true

echo "✅  obsidian-marp $TAG installed → $PLUGIN_DIR"
echo ""
echo "Next steps:"
echo "  1. Open Obsidian → vault: $(dirname "$PLUGIN_DIR" | xargs dirname)"
echo "  2. Settings → Community plugins → Enable 'Marp Slides'"
echo "  3. Open wiki/slides.md and click the Marp preview button"
