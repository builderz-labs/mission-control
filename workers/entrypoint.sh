#!/usr/bin/env bash
set -euo pipefail

: "${MC_FLY_CONTROL_URL:?MC_FLY_CONTROL_URL is required}"
: "${MC_FLY_JOB_ID:?MC_FLY_JOB_ID is required}"
: "${MC_FLY_JOB_TOKEN:?MC_FLY_JOB_TOKEN is required}"
: "${MC_FLY_REPOSITORY:?MC_FLY_REPOSITORY is required}"
: "${MC_FLY_BRANCH:?MC_FLY_BRANCH is required}"
: "${MC_FLY_BASE_SHA:?MC_FLY_BASE_SHA is required}"

job_url="${MC_FLY_CONTROL_URL%/}/api/fly/jobs/${MC_FLY_JOB_ID}"
header=( -H "x-mc-fly-job-token: ${MC_FLY_JOB_TOKEN}" )
post() { curl --fail --silent --show-error --retry 3 --connect-timeout 10 --max-time 60 "${header[@]}" -H 'content-type: application/json' -X POST -d "$1" "$job_url"; }
fail() { post "$(jq -nc --arg message "$1" '{state:"failed",error_message:$message}')" >/dev/null || true; }
trap 'fail "Worker exited unexpectedly"' ERR

job_file="$(mktemp)"
curl --fail --silent --show-error --retry 3 --connect-timeout 10 --max-time 60 "${header[@]}" "$job_url" > "$job_file"
prompt_file="$(mktemp)"
jq -r '"You are executing a Mission Control task in an isolated Git branch.\n\n# \(.task.title)\n\n\(.task.description // \"\")\n\nImplement the task, run relevant tests, commit changes, and report succinctly."' "$job_file" > "$prompt_file"

workdir="$(mktemp -d /tmp/mc-worker.XXXXXX)"
if [ -n "${MC_FLY_GIT_AUTH_TOKEN:-}" ]; then
  askpass="$workdir/git-askpass"
  printf '%s\n' '#!/usr/bin/env sh' 'case "$1" in *Username*) printf "%s\n" x-access-token ;; *) printf "%s\n" "$MC_FLY_GIT_AUTH_TOKEN" ;; esac' > "$askpass"
  chmod 700 "$askpass"
  export GIT_ASKPASS="$askpass"
fi
mkdir "$workdir/repo"
cd "$workdir/repo"
git init --quiet
git remote add origin "$MC_FLY_REPOSITORY"
GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30 fetch --depth 1 origin "$MC_FLY_BASE_SHA"
git checkout --quiet --detach FETCH_HEAD
git checkout --quiet -b "$MC_FLY_BRANCH"
git config user.name "Mission Control Fly Worker"
git config user.email "fly-worker@mission-control.local"
post '{"state":"running"}' >/dev/null

metrics() {
  local cpu memory swap
  cpu="$(ps -Ao %cpu= 2>/dev/null | awk '{ total += $1 } END { printf "%.2f", total + 0 }')"
  memory="$(ps -Ao rss= 2>/dev/null | awk '{ total += $1 } END { printf "%.0f", total * 1024 }')"
  swap="$(free -b 2>/dev/null | awk '/^Swap:/ { print $3 }' || true)"
  jq -nc --argjson cpu "${cpu:-0}" --argjson memory "${memory:-0}" --argjson swap "${swap:-0}" \
    '{state:"running",cpu_percent:$cpu,memory_bytes:$memory,swap_bytes:$swap}'
}

heartbeat() { while sleep "${MC_FLY_HEARTBEAT_SECONDS:-30}"; do post "$(metrics)" >/dev/null || true; done; }
heartbeat & heartbeat_pid=$!
trap 'kill "$heartbeat_pid" 2>/dev/null || true; fail "Worker exited unexpectedly"' ERR

case "${MC_FLY_SETUP_PROFILE:-none}" in
  none) ;;
  npm-ci) test -f package-lock.json && timeout --signal=TERM "${MC_FLY_SETUP_TIMEOUT_SECONDS:-900}" npm ci ;;
  npm-ci-playwright)
    test "${MC_FLY_WORKER_CLASS:-}" = browser
    test -f package-lock.json && timeout --signal=TERM "${MC_FLY_SETUP_TIMEOUT_SECONDS:-1200}" npm ci
    timeout --signal=TERM "${MC_FLY_SETUP_TIMEOUT_SECONDS:-1200}" npx playwright install chromium
    ;;
  *) fail "Unsupported setup profile"; exit 1 ;;
esac

command_timeout="${MC_FLY_COMMAND_TIMEOUT_SECONDS:-1500}"
set +e
case "${MC_FLY_AGENT_RUNTIME:-}" in
  claude)
    timeout --kill-after=30s --signal=TERM "$command_timeout" claude -p --output-format json --dangerously-skip-permissions --max-turns 40 < "$prompt_file" > "$workdir/agent-output.txt" 2>&1
    ;;
  codex)
    timeout --kill-after=30s --signal=TERM "$command_timeout" codex exec --sandbox workspace-write --skip-git-repo-check - < "$prompt_file" > "$workdir/agent-output.txt" 2>&1
    ;;
  *)
    fail "Unsupported agent runtime"
    exit 64
    ;;
esac
agent_status=$?
set -e
if [ "$agent_status" -ne 0 ]; then
  kill "$heartbeat_pid" 2>/dev/null || true
  fail "Agent command exited with status $agent_status"
  exit "$agent_status"
fi

git add -A
if ! git diff --cached --quiet; then
  git commit -m "feat: complete Mission Control task ${MC_FLY_JOB_ID:0:8}"
  GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30 push origin "$MC_FLY_BRANCH"
fi
kill "$heartbeat_pid" 2>/dev/null || true
rm -f "${askpass:-}"
unset MC_FLY_GIT_AUTH_TOKEN
resolution="Worker completed and pushed ${MC_FLY_BRANCH}; review the branch diff for details."
post "$(jq -nc --arg resolution "$resolution" --arg branch "$MC_FLY_BRANCH" '{state:"succeeded",resolution:$resolution,branch_name:$branch}')" >/dev/null
