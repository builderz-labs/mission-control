#!/usr/bin/env bash
#
# Daily Mission Control digest (runs on the VPS via systemd timer) — the
# feedback/learning loop. Reads the SQLite DB READ-ONLY (no writes, safe while
# MC is live) and reports throughput + failure signals so problems surface
# instead of silently accumulating:
#   * task counts by status, stuck tasks (in_progress > 24h)
#   * 7-day completion vs failure rate, worst projects/agents by failure
#   * DB + WAL size
# Output is appended to a dated digest file and (if SLACK_WEBHOOK_URL set) a
# short summary is posted to Slack. Fail-soft: always exits 0.
#
set -uo pipefail

CONTAINER="mission-control"
OPS_DIR="${MC_OPS_LOG_DIR:-/opt/mc-ops}"
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
DAY="$(date -u +%Y-%m-%d)"
OUT="${OPS_DIR}/digest-${DAY}.txt"

mkdir -p "$OPS_DIR" 2>/dev/null || true

JS="$(mktemp /tmp/mc-digest.XXXXXX.js)"
trap 'rm -f "$JS"' EXIT

cat > "$JS" <<'NODE'
const D = require('better-sqlite3');
const db = new D('/app/.data/mission-control.db', { readonly: true });
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return [{ _err: e.message }]; } };
const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch (e) { return { _err: e.message }; } };

const out = [];
out.push('MISSION CONTROL — DAILY DIGEST  ' + new Date().toISOString());

// Tasks by status
const byStatus = q('SELECT status, COUNT(*) c FROM tasks GROUP BY status ORDER BY c DESC');
out.push('\nTasks by status:');
for (const r of byStatus) out.push('  ' + (r.status ?? '?') + ': ' + (r.c ?? r._err));

// Stuck: in_progress not updated in 24h
const stuck = one("SELECT COUNT(*) c FROM tasks WHERE status='in_progress' AND updated_at < ?", now - DAY);
out.push('\nStuck (in_progress > 24h): ' + (stuck.c ?? stuck._err));
const stuckList = q("SELECT id, title, ROUND((?-updated_at)/3600.0,1) hrs FROM tasks WHERE status='in_progress' AND updated_at < ? ORDER BY updated_at ASC LIMIT 10", now, now - DAY);
for (const r of stuckList) if (!r._err) out.push('  #' + r.id + ' [' + r.hrs + 'h] ' + String(r.title).slice(0, 70));

// 7-day throughput
const wk = now - 7 * DAY;
const done7 = one("SELECT COUNT(*) c FROM tasks WHERE status='done' AND COALESCE(completed_at,updated_at) >= ?", wk).c || 0;
const failed7 = one("SELECT COUNT(*) c FROM tasks WHERE (status='failed' OR outcome='failed') AND updated_at >= ?", wk).c || 0;
const total7 = done7 + failed7;
const rate = total7 ? ((failed7 / total7) * 100).toFixed(1) : '0.0';
out.push('\n7-day: done=' + done7 + ' failed=' + failed7 + ' failure_rate=' + rate + '%');

// Worst projects by failure (7d)
const worst = q("SELECT COALESCE(project_name,'(none)') p, COUNT(*) c FROM tasks WHERE (status='failed' OR outcome='failed') AND updated_at >= ? GROUP BY p ORDER BY c DESC LIMIT 5", wk);
const worstReal = worst.filter(r => !r._err && r.c);
if (worstReal.length) { out.push('Top failing projects (7d):'); for (const r of worstReal) out.push('  ' + r.p + ': ' + r.c); }

// Agent activity
const agents = q('SELECT status, COUNT(*) c FROM agents GROUP BY status');
if (agents.length && !agents[0]._err) { out.push('\nAgents by status:'); for (const r of agents) out.push('  ' + r.status + ': ' + r.c); }

const pageCount = one('PRAGMA page_count').page_count || 0;
const pageSize = one('PRAGMA page_size').page_size || 0;
out.push('\nDB size: ' + ((pageCount * pageSize) / 1048576).toFixed(1) + 'MB  journal=' + (one('PRAGMA journal_mode').journal_mode || '?'));

db.close();
// Machine-readable summary line for Slack
out.push('\nSUMMARY: 7d done=' + done7 + ' failed=' + failed7 + ' (' + rate + '%), stuck=' + (stuck.c ?? '?'));
console.log(out.join('\n'));
NODE

REPORT="$(docker exec -i "$CONTAINER" node < "$JS" 2>&1)" || REPORT="digest failed: ${REPORT}"

{
  echo "==================== ${DAY} ===================="
  echo "$REPORT"
  echo
} >> "$OUT"

if [ -n "$SLACK_WEBHOOK_URL" ]; then
  summary="$(printf '%s\n' "$REPORT" | grep '^SUMMARY:' | sed 's/^SUMMARY: //')"
  [ -z "$summary" ] && summary="digest generated (see ${OUT})"
  curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"📊 MC daily digest — ${summary}\"}" "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

# Keep only the last 30 daily digests.
ls -1t "${OPS_DIR}"/digest-*.txt 2>/dev/null | tail -n +31 | xargs -r rm -f || true
exit 0
