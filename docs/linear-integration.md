# Linear Integration

Mission Control supports bidirectional sync with Linear issues.

## Setup

### 1. Generate Linear API Key

1. Go to [Linear Settings > API](https://linear.app/settings/api)
2. Click "Create new API key"
3. Copy the key

### 2. Configure Environment

Add to your `.env`:

```bash
LINEAR_API_KEY=lin_api_xxx
```

### 3. Set Up Webhook (Optional)

For real-time updates:

1. Go to [Linear Settings > Webhooks](https://linear.app/settings/webhooks)
2. Click "Add webhook"
3. Set URL to: `https://your-domain.com/api/linear/webhook`
4. Copy the **Signing Secret** (shown only once)
5. Add to `.env`:

```bash
LINEAR_WEBHOOK_SECRET=xxx
```

## Usage

### Connect a Project to Linear

1. Open Project Manager (Task Board → Projects)
2. Click edit on a project
3. Enter Linear Team ID (from Linear Settings > Teams)
4. Enable "Linear Sync" toggle
5. Save

### Manual Sync

Use the Linear Sync Panel ( Integrations → Linear) to:
- View available teams
- Trigger manual sync across all enabled projects
- View sync history

### Sync Behavior

**Inbound (Linear → MC):**
- New Linear issues create MC tasks
- Updates sync to existing tasks (if Linear is newer)
- Deleted issues mark MC task as `done`

**Outbound (MC → Linear):**
- New MC tasks create Linear issues
- Task updates modify Linear issues
- Status/priority map automatically

## Concept Mapping

### Status Mapping

| Mission Control | Linear WorkflowState |
|-----------------|---------------------|
| inbox | backlog |
| assigned | unstarted |
| in_progress | started |
| review | started |
| quality_review | started |
| done | completed |

### Priority Mapping

| Mission Control | Linear Priority |
|-----------------|-----------------|
| critical | 1 (Urgent) |
| high | 2 (High) |
| medium | 3 (Medium) |
| low | 4 (Low) |

## User Mapping

Configure agent-to-Linear-user mappings via the database `linear_user_mappings` table:

```sql
INSERT INTO linear_user_mappings (mc_agent_name, linear_user_id, workspace_id)
VALUES ('coordinator', 'user-linear-id', 1);
```

This allows automatic assignee resolution when pushing tasks to Linear.

## API Reference

### GET /api/linear

List available Linear teams.

**Response:**
```json
{
  "teams": [
    { "id": "...", "name": "Engineering", "key": "ENG" }
  ]
}
```

### POST /api/linear

Actions:

**`action: status`** - Get sync history

```bash
curl -X POST http://localhost:3000/api/linear \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"action": "status"}'
```

**`action: sync-project`** - Trigger manual sync for a project

```bash
curl -X POST http://localhost:3000/api/linear \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync-project", "project_id": 1}'
```

### POST /api/linear/webhook

Linear webhook endpoint. Configure in Linear Settings > Webhooks.

**Headers:**
- `linear-signature`: HMAC-SHA256 signature

**Payload:**
```json
{
  "type": "Issue.create",
  "data": {
    "id": "...",
    "identifier": "ENG-123",
    "title": "Fix bug",
    "state": { "type": "started", "name": "In Progress" },
    "priority": 2,
    "teamId": "..."
  }
}
```

## Troubleshooting

### "LINEAR_API_KEY not configured"

Ensure the environment variable is set and the server has been restarted.

### Webhook signature verification failed

- Check that `LINEAR_WEBHOOK_SECRET` matches the secret from Linear
- The secret is shown only once when creating the webhook

### Issues not syncing

1. Verify the project has Linear sync enabled
2. Check sync history for errors (Linear Sync Panel)
3. Ensure the Linear team has issues
4. Check `linear_syncs` table for error messages

### User mapping not working

Verify the mapping exists:

```sql
SELECT * FROM linear_user_mappings WHERE mc_agent_name = 'coordinator';
```

Ensure the Linear user ID is valid (from Linear API).
