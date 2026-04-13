-- 001_initial_schema.sql
-- Initial schema for registry.db: registry_meta, tools, tool_ports, schemas,
-- registration_log.

CREATE TABLE IF NOT EXISTS schema_versions (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS registry_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  version         INTEGER NOT NULL,
  description     TEXT,
  category        TEXT,
  tags_json       TEXT,
  entry_point     TEXT    NOT NULL,
  language        TEXT    NOT NULL,
  requires_json   TEXT,
  stability       TEXT,
  cost_class      TEXT,
  author          TEXT,
  created_at      TEXT    NOT NULL,
  tool_hash       TEXT    NOT NULL,
  tests_required  INTEGER NOT NULL,
  tests_passed    INTEGER,
  tests_run       INTEGER,
  status          TEXT    NOT NULL DEFAULT 'active',
  UNIQUE(name, version)
);

CREATE INDEX IF NOT EXISTS idx_tools_name     ON tools(name);
CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_status   ON tools(status);

CREATE TABLE IF NOT EXISTS tool_ports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id      INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  direction    TEXT    NOT NULL,
  port_name    TEXT    NOT NULL,
  schema_name  TEXT    NOT NULL,
  required     INTEGER,
  default_json TEXT,
  description  TEXT,
  position     INTEGER NOT NULL,
  UNIQUE(tool_id, direction, port_name)
);

CREATE INDEX IF NOT EXISTS idx_ports_schema ON tool_ports(schema_name, direction);

CREATE TABLE IF NOT EXISTS schemas (
  name                  TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,
  python_representation TEXT,
  encoding              TEXT NOT NULL,
  description           TEXT,
  source                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT    NOT NULL,
  tool_name     TEXT    NOT NULL,
  version       INTEGER,
  caller        TEXT    NOT NULL,
  outcome       TEXT    NOT NULL,
  error_message TEXT,
  tests_run     INTEGER,
  tests_passed  INTEGER,
  duration_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_registration_log_timestamp ON registration_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_registration_log_tool      ON registration_log(tool_name);

INSERT INTO schema_versions (version, applied_at, description)
VALUES (1, datetime('now'), 'Initial schema for registry.db');
