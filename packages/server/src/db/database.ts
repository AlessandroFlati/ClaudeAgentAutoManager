import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runMigrations } from './migrator.js';

const DB_DIR = path.join(os.homedir(), '.plurics');
const DB_PATH = path.join(DB_DIR, 'plurics.db');

// Legacy paths — migrated on first start
const LEGACY_DB_DIR = path.join(os.homedir(), '.caam');
const LEGACY_DB_PATH = path.join(LEGACY_DB_DIR, 'caam.db');

const PLURICS_MIGRATIONS_DIR = path.join(__dirname, 'migrations', 'plurics');

let db: Database.Database | null = null;

/**
 * One-time migration: copy ~/.caam/caam.db to ~/.plurics/plurics.db if the
 * legacy exists and the new location does not. The legacy file is left in
 * place as a safety net — user can delete it manually once satisfied.
 */
function migrateLegacyDb(): void {
  if (fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(LEGACY_DB_PATH)) return;
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  // Copy WAL / SHM sidecars if present so SQLite sees a consistent state
  for (const ext of ['-wal', '-shm']) {
    const legacySidecar = LEGACY_DB_PATH + ext;
    if (fs.existsSync(legacySidecar)) {
      fs.copyFileSync(legacySidecar, DB_PATH + ext);
    }
  }
  console.log(`[plurics] Migrated legacy DB from ${LEGACY_DB_PATH} to ${DB_PATH}`);
}

export function getDb(): Database.Database {
  if (db) return db;

  migrateLegacyDb();
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, PLURICS_MIGRATIONS_DIR);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
