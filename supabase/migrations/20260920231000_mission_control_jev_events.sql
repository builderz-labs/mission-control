-- Mission Control Jev archive in the explicitly selected Webdev project.
-- Append-only, idempotent event delivery. This table does not grant client access.
CREATE TABLE IF NOT EXISTS public.mission_control_jev_events (
  origin_instance_id uuid NOT NULL,
  event_id text NOT NULL CHECK(event_id ~ '^[a-f0-9]{32}$'),
  sequence bigint NOT NULL CHECK(sequence > 0),
  workspace_id bigint NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('upsert','delete')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(origin_instance_id,event_id),
  UNIQUE(origin_instance_id,sequence)
);
ALTER TABLE public.mission_control_jev_events
  DROP CONSTRAINT IF EXISTS mission_control_jev_events_entity_type_check;
ALTER TABLE public.mission_control_jev_events
  ADD CONSTRAINT mission_control_jev_events_entity_type_check CHECK(entity_type IN
    ('policies','evaluations','setup_sessions','setup_messages','setup_revisions','setup_revision_policies'));
ALTER TABLE public.mission_control_jev_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mission_control_jev_events FROM PUBLIC, anon, authenticated, webdev_app;
REVOKE ALL ON public.mission_control_jev_events FROM service_role;
GRANT SELECT, INSERT ON public.mission_control_jev_events TO service_role;
CREATE INDEX IF NOT EXISTS mission_control_jev_events_entity
  ON public.mission_control_jev_events(origin_instance_id,workspace_id,entity_type,entity_id,sequence DESC);
COMMENT ON TABLE public.mission_control_jev_events IS
  'Server-only redacted Jev persistence. Raw evaluation state and credentials are excluded. Latest entity state is the greatest sequence for each origin/entity; delete is a tombstone.';
