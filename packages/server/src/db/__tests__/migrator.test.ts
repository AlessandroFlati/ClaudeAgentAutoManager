import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DbType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { runMigrations } from '../migrator.js';

// Path to the real migration directories (used in integration tests)
const PLURICS_MIGRATIONS = path.join(__dirname, '../migrations/plurics');
const REGISTRY_MIGRATIONS = path.join(__dirname, '../migrations/registry');

// ---------- helpers ----------

function getSchemaVersion(db: DbType): number | null {
  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'")
    .get();
  if (!hasTable) return null;
  const row = db.prepare('SELECT version FROM schema_versions').get() as
    | { version: number }
    | undefined;
  return row?.version ?? null;
}

function tableExists(db: DbType, name: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

function columnExists(db: DbType, table: string, col: string): boolean {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.some((r) => r.name === col);
}

// Build a temporary migrations directory with given SQL files.
// Returns the temp dir path (caller cleans up).
function makeTempMigrationsDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrator-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

// ---------- tests ----------

describe('runMigrations — fresh database', () => {
  it('applies all registry migrations and reaches version 3', () => {
    const db = new Database(':memory:');
    const result = runMigrations(db, REGISTRY_MIGRATIONS);
    expect(result.applied).toBe(3);
    expect(result.currentVersion).toBe(3);
    expect(result.errors).toBeUndefined();
    expect(tableExists(db, 'tools')).toBe(true);
    expect(tableExists(db, 'converters')).toBe(true);
    expect(tableExists(db, 'tool_invocations')).toBe(true);
    expect(columnExists(db, 'tools', 'change_type')).toBe(true);
    db.close();
  });

  it('applies all plurics migrations and reaches version 1', () => {
    const db = new Database(':memory:');
    const result = runMigrations(db, PLURICS_MIGRATIONS);
    expect(result.applied).toBe(1);
    expect(result.currentVersion).toBe(1);
    expect(tableExists(db, 'workspaces')).toBe(true);
    expect(tableExists(db, 'workflow_runs')).toBe(true);
    expect(tableExists(db, 'workflow_events')).toBe(true);
    db.close();
  });
});

describe('runMigrations — one-time transition from legacy state', () => {
  it('detects registry v1 legacy DB and applies 002+003', () => {
    const db = new Database(':memory:');
    // Simulate a v1 registry (has tools table, no converters, no schema_versions)
    db.exec(`
      CREATE TABLE tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, version INTEGER NOT NULL,
        description TEXT, category TEXT, tags_json TEXT,
        entry_point TEXT NOT NULL, language TEXT NOT NULL,
        requires_json TEXT, stability TEXT, cost_class TEXT, author TEXT,
        created_at TEXT NOT NULL, tool_hash TEXT NOT NULL,
        tests_required INTEGER NOT NULL, tests_passed INTEGER, tests_run INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        UNIQUE(name, version)
      );
      CREATE TABLE tool_ports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tool_id INTEGER NOT NULL,
        direction TEXT NOT NULL, port_name TEXT NOT NULL,
        schema_name TEXT NOT NULL, required INTEGER, default_json TEXT,
        description TEXT, position INTEGER NOT NULL
      );
      CREATE TABLE schemas (
        name TEXT PRIMARY KEY, kind TEXT NOT NULL,
        python_representation TEXT, encoding TEXT NOT NULL,
        description TEXT, source TEXT NOT NULL
      );
      CREATE TABLE registration_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
        tool_name TEXT NOT NULL, version INTEGER, caller TEXT NOT NULL,
        outcome TEXT NOT NULL, error_message TEXT, tests_run INTEGER,
        tests_passed INTEGER, duration_ms INTEGER
      );
      CREATE TABLE registry_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO registry_meta VALUES ('schema_version', '1');
    `);
    const result = runMigrations(db, REGISTRY_MIGRATIONS);
    // Should have detected v1 and applied 002 and 003
    expect(result.applied).toBe(2);
    expect(result.currentVersion).toBe(3);
    expect(tableExists(db, 'converters')).toBe(true);
    expect(tableExists(db, 'tool_invocations')).toBe(true);
    db.close();
  });

  it('detects registry v2 legacy DB and applies only 003', () => {
    const db = new Database(':memory:');
    // Simulate v2 — has converters but no tool_invocations
    db.exec(`
      CREATE TABLE tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        version INTEGER NOT NULL, description TEXT, category TEXT,
        tags_json TEXT, entry_point TEXT NOT NULL, language TEXT NOT NULL,
        requires_json TEXT, stability TEXT, cost_class TEXT, author TEXT,
        created_at TEXT NOT NULL, tool_hash TEXT NOT NULL,
        tests_required INTEGER NOT NULL, tests_passed INTEGER, tests_run INTEGER,
        status TEXT NOT NULL DEFAULT 'active', UNIQUE(name, version)
      );
      CREATE TABLE tool_ports (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_id INTEGER NOT NULL, direction TEXT NOT NULL, port_name TEXT NOT NULL, schema_name TEXT NOT NULL, required INTEGER, default_json TEXT, description TEXT, position INTEGER NOT NULL);
      CREATE TABLE schemas (name TEXT PRIMARY KEY, kind TEXT NOT NULL, python_representation TEXT, encoding TEXT NOT NULL, description TEXT, source TEXT NOT NULL);
      CREATE TABLE registration_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, tool_name TEXT NOT NULL, version INTEGER, caller TEXT NOT NULL, outcome TEXT NOT NULL, error_message TEXT, tests_run INTEGER, tests_passed INTEGER, duration_ms INTEGER);
      CREATE TABLE registry_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO registry_meta VALUES ('schema_version', '2');
      CREATE TABLE converters (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_schema TEXT NOT NULL,
        target_schema TEXT NOT NULL, tool_name TEXT NOT NULL,
        tool_version INTEGER NOT NULL, registered_at TEXT NOT NULL,
        UNIQUE(source_schema, target_schema)
      );
    `);
    const result = runMigrations(db, REGISTRY_MIGRATIONS);
    expect(result.applied).toBe(1);
    expect(result.currentVersion).toBe(3);
    expect(tableExists(db, 'tool_invocations')).toBe(true);
    db.close();
  });

  it('detects registry v3 legacy DB and applies nothing', () => {
    const db = new Database(':memory:');
    // Simulate v3 — has tools, converters, tool_invocations, no schema_versions
    db.exec(`
      CREATE TABLE tools (id INTEGER PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, description TEXT, category TEXT, tags_json TEXT, entry_point TEXT NOT NULL, language TEXT NOT NULL, requires_json TEXT, stability TEXT, cost_class TEXT, author TEXT, created_at TEXT NOT NULL, tool_hash TEXT NOT NULL, tests_required INTEGER NOT NULL, tests_passed INTEGER, tests_run INTEGER, status TEXT NOT NULL DEFAULT 'active', change_type TEXT NOT NULL DEFAULT 'net_new', UNIQUE(name, version));
      CREATE TABLE converters (id INTEGER PRIMARY KEY, source_schema TEXT, target_schema TEXT, tool_name TEXT, tool_version INTEGER, registered_at TEXT);
      CREATE TABLE tool_invocations (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, tool_name TEXT NOT NULL, tool_version INTEGER NOT NULL, run_id TEXT, node_name TEXT, scope TEXT, duration_ms INTEGER, success INTEGER NOT NULL);
      CREATE TABLE tool_ports (id INTEGER PRIMARY KEY, tool_id INTEGER, direction TEXT, port_name TEXT, schema_name TEXT, required INTEGER, default_json TEXT, description TEXT, position INTEGER);
      CREATE TABLE schemas (name TEXT PRIMARY KEY, kind TEXT, python_representation TEXT, encoding TEXT, description TEXT, source TEXT);
      CREATE TABLE registration_log (id INTEGER PRIMARY KEY, timestamp TEXT, tool_name TEXT, version INTEGER, caller TEXT, outcome TEXT, error_message TEXT, tests_run INTEGER, tests_passed INTEGER, duration_ms INTEGER);
      CREATE TABLE registry_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO registry_meta VALUES ('schema_version', '3');
    `);
    const result = runMigrations(db, REGISTRY_MIGRATIONS);
    expect(result.applied).toBe(0);
    expect(result.currentVersion).toBe(3);
    db.close();
  });
});

describe('runMigrations — already at current version', () => {
  it('is a no-op when version matches', () => {
    const db = new Database(':memory:');
    // First run
    runMigrations(db, REGISTRY_MIGRATIONS);
    // Second run — should be a no-op
    const result = runMigrations(db, REGISTRY_MIGRATIONS);
    expect(result.applied).toBe(0);
    expect(result.currentVersion).toBe(3);
    db.close();
  });
});

describe('runMigrations — gap detection', () => {
  it('throws when a migration file is missing in the sequence', () => {
    const dir = makeTempMigrationsDir({
      '001_init.sql': `
        CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT);
        CREATE TABLE foo (id INTEGER PRIMARY KEY);
        INSERT INTO schema_versions VALUES (1, datetime('now'), 'init');
      `,
      // 002 is intentionally missing
      '003_third.sql': `
        CREATE TABLE baz (id INTEGER PRIMARY KEY);
        UPDATE schema_versions SET version=3, applied_at=datetime('now'), description='third';
      `,
    });
    try {
      const db = new Database(':memory:');
      expect(() => runMigrations(db, dir)).toThrow(/gap/i);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});

describe('runMigrations — transaction rollback on failure', () => {
  it('leaves the DB at the previous version when a migration throws', () => {
    const dir = makeTempMigrationsDir({
      '001_init.sql': `
        CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT);
        CREATE TABLE foo (id INTEGER PRIMARY KEY);
        INSERT INTO schema_versions VALUES (1, datetime('now'), 'init');
      `,
      '002_bad.sql': `
        THIS IS NOT VALID SQL AND WILL FAIL;
        UPDATE schema_versions SET version=2, applied_at=datetime('now'), description='bad';
      `,
    });
    try {
      const db = new Database(':memory:');
      expect(() => runMigrations(db, dir)).toThrow();
      // DB should be at version 1 — the bad migration was rolled back
      expect(getSchemaVersion(db)).toBe(1);
      // The table created by 001 should still exist
      expect(tableExists(db, 'foo')).toBe(true);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
