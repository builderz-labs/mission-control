#!/usr/bin/env bash
# Seed Mission Control with realistic demo data via the REST API.
# Usage: ./scripts/seed-demo-data.sh [BASE_URL]
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "🔑  Logging in..."
curl -sf -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change-me-on-first-login"}' \
  -c "$COOKIE_JAR" -o /dev/null

api() {
  local method="$1" path="$2"; shift 2
  curl -sf -X "$method" "$BASE$path" \
    -H "Content-Type: application/json" \
    -b "$COOKIE_JAR" "$@"
}

# ── Agents ────────────────────────────────────────
echo "🤖  Creating agents..."
for agent in \
  '{"name":"atlas","role":"developer","status":"busy","session_key":"atlas-session-001"}' \
  '{"name":"scout","role":"researcher","status":"idle","session_key":"scout-session-001"}' \
  '{"name":"forge","role":"developer","status":"busy","session_key":"forge-session-002"}' \
  '{"name":"oracle","role":"analyst","status":"idle","session_key":"oracle-session-001"}' \
  '{"name":"aegis","role":"reviewer","status":"offline","session_key":"aegis-session-001"}' \
  '{"name":"herald","role":"communicator","status":"idle","session_key":"herald-session-001"}'; do
  api POST /api/agents -d "$agent" -o /dev/null 2>/dev/null || true
done

# ── Tasks ─────────────────────────────────────────
echo "📋  Creating tasks..."
for task in \
  '{"title":"Implement user authentication flow","description":"Add OAuth2 login with Google and GitHub providers. Include session management, token refresh, and logout functionality.","status":"done","priority":"high","assigned_to":"atlas","tags":["auth","security","backend"]}' \
  '{"title":"Design system component library","description":"Create a reusable component library with buttons, inputs, modals, and cards following the design system spec.","status":"done","priority":"high","assigned_to":"forge","tags":["ui","components","design-system"]}' \
  '{"title":"Set up CI/CD pipeline","description":"Configure GitHub Actions for linting, testing, building, and deploying to staging on merge to main.","status":"in_progress","priority":"high","assigned_to":"atlas","tags":["devops","ci-cd"]}' \
  '{"title":"Research vector database options","description":"Compare Pinecone, Weaviate, Qdrant, and pgvector for our embedding storage needs. Consider cost, latency, and scaling.","status":"in_progress","priority":"medium","assigned_to":"scout","tags":["research","database","ai"]}' \
  '{"title":"API rate limiting middleware","description":"Implement sliding window rate limiter with per-user and per-IP limits. Add X-RateLimit headers.","status":"review","priority":"high","assigned_to":"forge","tags":["backend","security","api"]}' \
  '{"title":"Write integration test suite","description":"Cover all critical API paths: auth, tasks CRUD, agent lifecycle, and webhook delivery.","status":"assigned","priority":"medium","assigned_to":"atlas","tags":["testing","quality"]}' \
  '{"title":"Cost analysis dashboard","description":"Build charts showing token usage trends, per-model costs, and daily/weekly/monthly breakdowns using Recharts.","status":"assigned","priority":"medium","assigned_to":"oracle","tags":["dashboard","analytics","ui"]}' \
  '{"title":"Webhook retry with exponential backoff","description":"Add retry logic for failed webhook deliveries: max 5 retries with exponential backoff (1s, 2s, 4s, 8s, 16s).","status":"inbox","priority":"medium","tags":["backend","webhooks"]}' \
  '{"title":"OpenAPI specification","description":"Generate OpenAPI 3.1 spec for all 30+ API routes. Include request/response schemas and examples.","status":"inbox","priority":"low","tags":["documentation","api"]}' \
  '{"title":"Agent memory search optimization","description":"Add full-text search indexing for agent memory files. Support fuzzy matching and relevance scoring.","status":"inbox","priority":"medium","tags":["search","performance","ai"]}' \
  '{"title":"Multi-tenant isolation audit","description":"Review all database queries and file system access for tenant boundary enforcement. Document findings.","status":"assigned","priority":"critical","assigned_to":"aegis","tags":["security","audit","multi-tenant"]}' \
  '{"title":"Dark mode polish","description":"Fix contrast issues in dark mode: sidebar hover states, chart colors, and notification badges need adjustment.","status":"in_progress","priority":"low","assigned_to":"forge","tags":["ui","accessibility"]}'; do
  api POST /api/tasks -d "$task" -o /dev/null 2>/dev/null || true
done

# ── Token Usage Records ───────────────────────────
echo "💰  Seeding token usage records..."
NOW_MS=$(date +%s)000
HOUR_MS=3600000
models=("anthropic/claude-sonnet-4-20250514" "anthropic/claude-3-5-haiku-latest" "groq/llama-3.3-70b-versatile" "anthropic/claude-opus-4-5")
sessions=("atlas:code" "scout:research" "forge:code" "oracle:analysis" "herald:chat")
operations=("chat_completion" "code_generation" "analysis" "summarization" "embedding")

for i in $(seq 1 40); do
  model="${models[$((RANDOM % ${#models[@]}))]}"
  session="${sessions[$((RANDOM % ${#sessions[@]}))]}"
  operation="${operations[$((RANDOM % ${#operations[@]}))]}"
  input_tokens=$(( RANDOM % 3000 + 500 ))
  output_tokens=$(( RANDOM % 2000 + 200 ))
  offset=$(( i * HOUR_MS / 2 ))
  ts=$(( ${NOW_MS%000} * 1000 - offset ))
  duration=$(( RANDOM % 5000 + 500 ))

  api POST /api/tokens -d "{
    \"model\": \"$model\",
    \"sessionId\": \"$session\",
    \"inputTokens\": $input_tokens,
    \"outputTokens\": $output_tokens,
    \"operation\": \"$operation\",
    \"duration\": $duration
  }" -o /dev/null 2>/dev/null || true
done

# ── Task Comments ─────────────────────────────────
echo "💬  Adding task comments..."
# Comment on task 3 (CI/CD pipeline)
api POST /api/tasks/3/comments -d '{"author":"atlas","content":"GitHub Actions workflow is set up. Working on the deploy step now — need to figure out the staging environment credentials."}' -o /dev/null 2>/dev/null || true
api POST /api/tasks/3/comments -d '{"author":"forge","content":"@atlas I can help with the Docker build step. I have a multi-stage Dockerfile ready from the component library work."}' -o /dev/null 2>/dev/null || true
api POST /api/tasks/3/comments -d '{"author":"admin","content":"Lets target having this done by end of week. Staging deploys are blocking the QA team."}' -o /dev/null 2>/dev/null || true

# Comment on task 5 (rate limiting)
api POST /api/tasks/5/comments -d '{"author":"forge","content":"Implementation is done. Using a sliding window counter with Redis-like in-memory store. Added X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers."}' -o /dev/null 2>/dev/null || true
api POST /api/tasks/5/comments -d '{"author":"aegis","content":"Reviewing now. The sliding window approach looks solid. One concern: what happens when the server restarts? The in-memory counters reset."}' -o /dev/null 2>/dev/null || true

# Comment on task 4 (vector DB research)
api POST /api/tasks/4/comments -d '{"author":"scout","content":"Initial findings: Qdrant has the best price/performance ratio for our scale. Pinecone is easiest to set up but 3x the cost. Writing up the full comparison doc now."}' -o /dev/null 2>/dev/null || true

echo ""
echo "✅  Demo data seeded successfully!"
echo "   • 6 agents (2 busy, 3 idle, 1 offline)"
echo "   • 12 tasks across all statuses"
echo "   • 40 token usage records"
echo "   • 6 task comments"
echo ""
echo "Open $BASE to see the dashboard in action."
