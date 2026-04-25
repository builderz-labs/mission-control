-- Proposal assessment workflow columns.
-- Idempotent — safe to re-run; ALTER TABLE ... ADD COLUMN errors swallowed by runner.
--
-- Adds Claude's pre-assessment + Ross's decision + implementation tracking
-- so /proposals can render the full review state.

ALTER TABLE proposals ADD COLUMN claude_recommendation TEXT;
ALTER TABLE proposals ADD COLUMN claude_reasoning TEXT;
ALTER TABLE proposals ADD COLUMN claude_assessed_at TEXT;
ALTER TABLE proposals ADD COLUMN ross_decision TEXT;
ALTER TABLE proposals ADD COLUMN ross_decided_at TEXT;
ALTER TABLE proposals ADD COLUMN ross_notes TEXT;
ALTER TABLE proposals ADD COLUMN implementation_status TEXT;
ALTER TABLE proposals ADD COLUMN implementation_pr TEXT;
ALTER TABLE proposals ADD COLUMN shipped_in_version TEXT;
