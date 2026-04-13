-- 002_add_converters.sql
-- Adds converters table and index (v1 -> v2 transition).

CREATE TABLE IF NOT EXISTS converters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_schema TEXT    NOT NULL,
  target_schema TEXT    NOT NULL,
  tool_name     TEXT    NOT NULL,
  tool_version  INTEGER NOT NULL,
  registered_at TEXT    NOT NULL,
  UNIQUE(source_schema, target_schema)
);

CREATE INDEX IF NOT EXISTS idx_converters_pair
  ON converters(source_schema, target_schema);

UPDATE schema_versions SET
  version     = 2,
  applied_at  = datetime('now'),
  description = 'Add converters table';
