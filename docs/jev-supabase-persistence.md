# Jev persistence in Webdev

Mission Control writes Jev policies, evaluations, setup sessions, messages, and
revisions to its local database. SQLite triggers enqueue each change in the same
transaction. A five-second server worker copies pending records to the selected
Webdev Supabase project, `nivlxzlxnfsgashuomxb`.

Apply `supabase/migrations/20260920231000_mission_control_jev_events.sql` to that
project, then configure these server-only settings through Mission Control's
Backend production config in Doppler:

- `MC_SUPABASE_PROJECT_REF=nivlxzlxnfsgashuomxb`
- `MC_SUPABASE_URL=https://nivlxzlxnfsgashuomxb.supabase.co`
- `MC_SUPABASE_SECRET_KEY`: that project's Supabase secret API key.

The destination is pinned and validated. Credentials are sent only in the
`apikey` header. Each request has a ten-second deadline and one retry. Failed
events remain queued with bounded backoff. The exact redacted request is frozen
before delivery, and its origin/event identifiers make replay idempotent.
`payload_sha256` hashes canonical JSON of the redacted `payload` value: object keys
are recursively sorted and arrays retain their order. This supports verification
after PostgreSQL has reordered JSON object keys.

`GET /api/jev/status` includes workspace-scoped `status.cloud`: configuration,
pending/synced counts, last acknowledgement time, and a safe failure code. A local
save is not a cloud acknowledgement. `local_only` means no cloud destination is
configured; `ready` means configured with no records yet; `pending`, `retrying`,
and `synced` describe the queue.

Supabase stores redacted entity snapshots and ordered mutation metadata. Raw
evaluation input, input previews, and input hashes are excluded. Mutable entities
are sampled when first delivered, so several pending edits may share the latest
snapshot; this archive is not a reconstruction of every intermediate edit.
Messages and revisions retain individual records. Deletions produce tombstones. Select the
greatest sequence per origin/entity when reconstructing its latest saved state.

The cloud table has row-level security and no anonymous or signed-in-user access.
The server role has only SELECT/INSERT privileges on this table. The secret API
key itself remains a privileged project credential and must stay server-side.

SQLite remains the active source of truth. This release does not restore local
data from Supabase or provide multi-device concurrent editing. Preserve the local
database in backups, including its origin identifier and outbox. Restoring an old
backup to an active second writer requires an explicit new-origin migration.
