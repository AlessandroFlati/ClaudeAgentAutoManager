import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

function resolveDefaultRoot(): string {
  const envOverride = process.env.PLURICS_REGISTRY_ROOT;
  if (envOverride && envOverride.trim() !== '') return envOverride;
  return path.join(os.homedir(), '.plurics', 'registry');
}

export class RegistryLayout {
  readonly rootDir: string;
  readonly toolsDir: string;
  readonly schemasDir: string;
  readonly stagingDir: string;
  readonly logsDir: string;
  readonly dbPath: string;
  readonly runnerPath: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? resolveDefaultRoot();
    this.toolsDir = path.join(this.rootDir, 'tools');
    this.schemasDir = path.join(this.rootDir, 'schemas');
    this.stagingDir = path.join(this.rootDir, 'staging');
    this.logsDir = path.join(this.rootDir, 'logs');
    this.dbPath = path.join(this.rootDir, 'registry.db');
    this.runnerPath = path.join(this.rootDir, 'runner.py');
  }

  toolVersionDir(name: string, version: number): string {
    return path.join(this.toolsDir, name, `v${version}`);
  }

  ensureLayout(): void {
    for (const d of [this.rootDir, this.toolsDir, this.schemasDir, this.stagingDir, this.logsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  createStagingDir(): string {
    fs.mkdirSync(this.stagingDir, { recursive: true });
    const dir = path.join(this.stagingDir, randomUUID());
    fs.mkdirSync(dir);
    return dir;
  }

  commitStaging(stagedDir: string, targetDir: string): void {
    if (fs.existsSync(targetDir)) {
      throw new Error(`target directory already exists: ${targetDir}`);
    }
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(stagedDir, targetDir);
  }

  cleanupStaging(stagedDir: string): void {
    fs.rmSync(stagedDir, { recursive: true, force: true });
  }
}

/**
 * Compute SHA-256 over (relativePath, contentBytes) pairs, sorted by path
 * (POSIX separators for cross-OS stability). Directories are walked
 * recursively; symlinks are followed as regular files.
 */
export function hashToolDirectory(dir: string): string {
  const entries: Array<{ rel: string; content: Buffer }> = [];

  const walk = (current: string, prefix: string): void => {
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const child = path.join(current, item.name);
      const rel = prefix === '' ? item.name : `${prefix}/${item.name}`;
      if (item.isDirectory()) {
        walk(child, rel);
      } else if (item.isFile()) {
        entries.push({ rel, content: fs.readFileSync(child) });
      }
    }
  };

  walk(dir, '');
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const hash = createHash('sha256');
  for (const { rel, content } of entries) {
    hash.update(rel);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}
