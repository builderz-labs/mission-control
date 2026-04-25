-- Tracks whether a proposal decision has been echoed back to Discord.
-- Idempotent — duplicate column errors are swallowed by the migration runner.

ALTER TABLE proposals ADD COLUMN decision_echoed_at TEXT;
ALTER TABLE proposals ADD COLUMN decision_echo_message_id INTEGER;
