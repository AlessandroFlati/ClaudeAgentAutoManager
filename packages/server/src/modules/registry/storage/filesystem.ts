import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
}
