-- 003_add_tool_invocations.sql
-- Adds tool_invocations table and change_type column to tools (v2 -> v3 transition).

ALTER TABLE tools ADD COLUMN change_type TEXT NOT NULL DEFAULT 'net_new';

CREATE TABLE IF NOT EXISTS tool_invocations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    TEXT    NOT NULL,
  tool_name    TEXT    NOT NULL,
  tool_version INTEGER NOT NULL,
  run_id       TEXT,
  node_name    TEXT,
  scope        TEXT,
  duration_ms  INTEGER,
  success      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_inv_run  ON tool_invocations(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_inv_tool ON tool_invocations(tool_name, tool_version);

UPDATE schema_versions SET
  version     = 3,
  applied_at  = datetime('now'),
  description = 'Add tool_invocations table and change_type column';
