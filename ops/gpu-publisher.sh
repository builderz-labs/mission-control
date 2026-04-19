#!/usr/bin/env bash
# Publishes host GPU info to $OPENCLAW_HOME/gpu.json every ~5 seconds so a
# containerized Mission Control can display GPU stats even when the container
# cannot access the host GPU directly. Run on macOS or Linux; the file is
# read through the read-only bind mount at /run/openclaw/gpu.json.
#
# Usage: ./gpu-publisher.sh [interval_seconds]

set -u

INTERVAL="${1:-5}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OUT="$OPENCLAW_HOME/gpu.json"
mkdir -p "$OPENCLAW_HOME"

# Try nvidia-smi first (Linux + CUDA on Windows-WSL; rare on macOS).
query_nvidia() {
  if ! command -v nvidia-smi >/dev/null 2>&1; then return 1; fi
  local out
  out="$(nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits 2>/dev/null || true)"
  [ -n "$out" ] || return 1
  local first=1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local name total used pct
    name="$(echo "$line" | awk -F',' '{gsub(/^[ \t]+|[ \t]+$/,"",$1); print $1}')"
    total="$(echo "$line" | awk -F',' '{gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2}')"
    used="$(echo "$line" | awk -F',' '{gsub(/^[ \t]+|[ \t]+$/,"",$3); print $3}')"
    [ "$total" -gt 0 ] 2>/dev/null && pct=$(( used * 100 / total )) || pct=0
    [ $first -eq 1 ] || printf ','
    first=0
    printf '{"name":"%s","memoryTotalMB":%s,"memoryUsedMB":%s,"usagePercent":%s}' \
      "$name" "$total" "$used" "$pct"
  done <<< "$out"
  return 0
}

# macOS fallback: system_profiler JSON.
query_macos() {
  [ "$(uname)" = "Darwin" ] || return 1
  command -v system_profiler >/dev/null 2>&1 || return 1
  local json
  json="$(system_profiler SPDisplaysDataType -json 2>/dev/null || true)"
  [ -n "$json" ] || return 1
  # Need python3 or jq to parse; both are present on macOS 10.15+ via python3.
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY' <<<"$json"
import json, re, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    sys.exit(1)
items = data.get("SPDisplaysDataType", []) or []
out = []
for g in items:
    name = g.get("sppci_model") or g.get("_name") or "Unknown GPU"
    vram = g.get("spdisplays_vram") or g.get("spdisplays_vram_shared") or ""
    mb = 0
    m = re.search(r"([\d.]+)\s*GB", vram, re.I)
    if m:
        mb = int(float(m.group(1)) * 1024)
    else:
        m = re.search(r"([\d.]+)\s*MB", vram, re.I)
        if m:
            mb = int(float(m.group(1)))
    out.append({"name": name, "memoryTotalMB": mb, "memoryUsedMB": 0, "usagePercent": 0})
sys.stdout.write(",".join(json.dumps(x) for x in out))
PY
    return 0
  fi
  return 1
}

# Linux fallback: lspci for names only, no memory/usage.
query_lspci() {
  command -v lspci >/dev/null 2>&1 || return 1
  local out first=1
  out="$(lspci -mm 2>/dev/null | grep -iE '"(VGA|3D|Display) ' || true)"
  [ -n "$out" ] || return 1
  while IFS= read -r line; do
    local name
    name="$(echo "$line" | awk -F'"' '{print $6" "$8}')"
    [ $first -eq 1 ] || printf ','
    first=0
    printf '{"name":"%s","memoryTotalMB":0,"memoryUsedMB":0,"usagePercent":0}' "$name"
  done <<< "$out"
  return 0
}

write_snapshot() {
  local gpus ts source
  ts="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  # Try probes in order. First one that emits anything wins.
  gpus="$(query_nvidia || true)"
  source="host-publisher/nvidia"
  if [ -z "$gpus" ]; then
    gpus="$(query_macos || true)"
    source="host-publisher/macos"
  fi
  if [ -z "$gpus" ]; then
    gpus="$(query_lspci || true)"
    source="host-publisher/lspci"
  fi
  [ -n "$gpus" ] || { gpus=""; source="host-publisher/none"; }

  local tmp="$OUT.tmp"
  printf '{"updatedAt":"%s","source":"%s","gpus":[%s]}' "$ts" "$source" "$gpus" > "$tmp" 2>/dev/null && mv -f "$tmp" "$OUT" 2>/dev/null
}

while true; do
  write_snapshot
  sleep "$INTERVAL"
done
