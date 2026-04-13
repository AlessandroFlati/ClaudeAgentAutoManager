import Database from 'better-sqlite3';
import type { Database as DbType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface MigrationResult {
  applied: number;
  currentVersion: number;
  errors?: string[];
}

// ---------- helpers ----------

function tableExists(db: DbType, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return row !== undefined;
}

function columnExists(db: DbType, table: string, column: string): boolean {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function getCurrentVersion(db: DbType): number {
  const rows = db.prepare('SELECT version FROM schema_versions').all() as Array<{ version: number }>;
  if (rows.length === 0) return 0;
  if (rows.length > 1) {
    throw new Error('schema_versions has multiple rows — database is corrupt');
  }
  return rows[0].version;
}

// ---------- feature-detection predicates for one-time transition ----------

/**
 * Detect the effective schema version of a plurics.db that pre-dates the
 * migration system (i.e. schema_versions table does not exist yet).
 *
 * The only version that existed before the migration system was v1 (the
 * initial schema with workspaces, workspace_agents, agent_presets,
 * workflow_runs, workflow_events). Return that if the tables are present,
 * otherwise treat as version 0 (empty / brand-new).
 */
function detectPluricsLegacyVersion(db: DbType): number {
  if (tableExists(db, 'workflow_runs')) return 1;
  return 0;
}

/**
 * Detect the effective schema version of a registry.db that pre-dates the
 * migration system.
 *
 * v1 — has tools table but no converters table, no change_type column
 * v2 — has converters table but no tool_invocations table
 * v3 — has tool_invocations table (and change_type column)
 * 0  — brand-new / empty
 */
function detectRegistryLegacyVersion(db: DbType): number {
  if (!tableExists(db, 'tools')) return 0;
  if (!tableExists(db, 'converters')) return 1;
  if (!tableExists(db, 'tool_invocations')) return 2;
  return 3;
}

// ---------- migration file parsing ----------

interface MigrationFile {
  version: number;
  filePath: string;
  ext: 'sql' | 'ts';
}

const MIGRATION_FILENAME_RE = /^(\d{3})_[a-z0-9_]+\.(sql|ts)$/;

function enumerateMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  const entries = fs.readdirSync(migrationsDir).sort();
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const match = MIGRATION_FILENAME_RE.exec(entry);
    if (!match) continue;
    files.push({
      version: parseInt(match[1], 10),
      filePath: path.join(migrationsDir, entry),
      ext: match[2] as 'sql' | 'ts',
    });
  }
  return files;
}

function validateSequence(files: MigrationFile[], startAfter: number): void {
  let expected = startAfter + 1;
  for (const f of files) {
    if (f.version !== expected) {
      throw new Error(
        `Migration sequence gap: expected version ${expected} but found ${f.version} (${path.basename(f.filePath)})`,
      );
    }
    expected++;
  }
}

// ---------- SQL version-bump verification ----------

function verifyVersionBumped(db: DbType, expectedVersion: number): void {
  const current = getCurrentVersion(db);
  if (current !== expectedVersion) {
    throw new Error(
      `Migration did not update schema_versions: expected version ${expectedVersion}, got ${current}`,
    );
  }
}

// ---------- main runner ----------

export function runMigrations(db: DbType, migrationsDir: string): MigrationResult {
  // --- Step 1: handle databases not yet in the migration system ---
  if (!tableExists(db, 'schema_versions')) {
    // Detect legacy state to find the effective current version.
    // If effectiveVersion === 0 the DB is brand-new — let migration 001 create
    // the schema_versions table and insert the first row. Only bootstrap if
    // there are already existing tables (i.e. the DB is a pre-migration legacy).
    const isRegistry = migrationsDir.includes('registry');
    const effectiveVersion = isRegistry
      ? detectRegistryLegacyVersion(db)
      : detectPluricsLegacyVersion(db);

    if (effectiveVersion > 0) {
      // Legacy DB: bootstrap schema_versions at the detected effective version.
      db.exec(`
        CREATE TABLE schema_versions (
          version     INTEGER PRIMARY KEY,
          applied_at  TEXT NOT NULL,
          description TEXT
        )
      `);
      db.prepare(
        `INSERT INTO schema_versions (version, applied_at, description)
         VALUES (?, datetime('now'), 'adopted from pre-migration-system state')`,
      ).run(effectiveVersion);
    }
    // If effectiveVersion === 0: brand-new DB, fall through and let migration 001 do the work.
  }

  // --- Step 2: read current version ---
  // schema_versions may not exist yet for a truly fresh DB (migration 001 creates it).
  const currentVersion = tableExists(db, 'schema_versions') ? getCurrentVersion(db) : 0;

  // --- Step 3: enumerate available migrations ---
  const allMigrations = enumerateMigrations(migrationsDir);

  // --- Step 4: filter to pending migrations ---
  const pending = allMigrations.filter((m) => m.version > currentVersion);
  if (pending.length === 0) {
    return { applied: 0, currentVersion };
  }

  // --- Step 5: validate contiguous sequence ---
  validateSequence(pending, currentVersion);

  // --- Step 6: execute each migration in a transaction ---
  const errors: string[] = [];
  let applied = 0;
  let lastVersion = currentVersion;

  for (const migration of pending) {
    const runMigration = db.transaction(() => {
      if (migration.ext === 'sql') {
        const sql = fs.readFileSync(migration.filePath, 'utf8');
        db.exec(sql);
      } else {
        // TypeScript migration: dynamic import is async, but we need sync execution.
        // We use require() here since the server compiles to CJS.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(migration.filePath) as { default: (db: DbType) => void };
        if (typeof mod.default !== 'function') {
          throw new Error(`TypeScript migration ${migration.filePath} must export a default function`);
        }
        mod.default(db);
      }
      verifyVersionBumped(db, migration.version);
    });

    try {
      runMigration();
      applied++;
      lastVersion = migration.version;
      console.log(`[migrator] Applied migration ${String(migration.version).padStart(3, '0')} from ${path.basename(migration.filePath)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Migration ${migration.version} (${path.basename(migration.filePath)}): ${msg}`);
      // Abort on first failure — database is at lastVersion
      throw new Error(
        `Migration system halted at version ${lastVersion}: ${msg}. ` +
          `Fix the migration and restart.`,
      );
    }
  }

  return errors.length > 0
    ? { applied, currentVersion: lastVersion, errors }
    : { applied, currentVersion: lastVersion };
}
