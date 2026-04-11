import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryLayout } from '../filesystem.js';
import { hashToolDirectory } from '../filesystem.js';

describe('RegistryLayout', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-reg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exposes the configured root', () => {
    const layout = new RegistryLayout(tmpRoot);
    expect(layout.rootDir).toBe(tmpRoot);
  });

  it('derives child directory paths', () => {
    const layout = new RegistryLayout(tmpRoot);
    expect(layout.toolsDir).toBe(path.join(tmpRoot, 'tools'));
    expect(layout.schemasDir).toBe(path.join(tmpRoot, 'schemas'));
    expect(layout.stagingDir).toBe(path.join(tmpRoot, 'staging'));
    expect(layout.logsDir).toBe(path.join(tmpRoot, 'logs'));
    expect(layout.dbPath).toBe(path.join(tmpRoot, 'registry.db'));
    expect(layout.runnerPath).toBe(path.join(tmpRoot, 'runner.py'));
  });

  it('toolVersionDir joins name and version', () => {
    const layout = new RegistryLayout(tmpRoot);
    expect(layout.toolVersionDir('sklearn.pca', 2))
      .toBe(path.join(tmpRoot, 'tools', 'sklearn.pca', 'v2'));
  });

  it('ensureLayout creates all required directories', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    expect(fs.existsSync(layout.toolsDir)).toBe(true);
    expect(fs.existsSync(layout.schemasDir)).toBe(true);
    expect(fs.existsSync(layout.stagingDir)).toBe(true);
    expect(fs.existsSync(layout.logsDir)).toBe(true);
  });

  it('ensureLayout is idempotent', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    layout.ensureLayout();
    expect(fs.existsSync(layout.toolsDir)).toBe(true);
  });

  it('defaults to ~/.plurics/registry when no root is given', () => {
    const layout = new RegistryLayout();
    expect(layout.rootDir).toBe(path.join(os.homedir(), '.plurics', 'registry'));
  });

  it('honours PLURICS_REGISTRY_ROOT env var', () => {
    const prior = process.env.PLURICS_REGISTRY_ROOT;
    process.env.PLURICS_REGISTRY_ROOT = tmpRoot;
    try {
      const layout = new RegistryLayout();
      expect(layout.rootDir).toBe(tmpRoot);
    } finally {
      if (prior === undefined) delete process.env.PLURICS_REGISTRY_ROOT;
      else process.env.PLURICS_REGISTRY_ROOT = prior;
    }
  });
});

describe('RegistryLayout — staging', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-reg-stage-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('createStagingDir returns an empty, existing directory', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    expect(fs.existsSync(staged)).toBe(true);
    expect(fs.readdirSync(staged)).toEqual([]);
    expect(staged.startsWith(layout.stagingDir)).toBe(true);
  });

  it('createStagingDir is unique per call', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const a = layout.createStagingDir();
    const b = layout.createStagingDir();
    expect(a).not.toBe(b);
  });

  it('commitStaging moves staged contents to the version directory', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    fs.writeFileSync(path.join(staged, 'tool.yaml'), 'name: x');
    fs.writeFileSync(path.join(staged, 'tool.py'), 'def run(): return {}');

    const target = layout.toolVersionDir('x.y', 1);
    layout.commitStaging(staged, target);

    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(path.join(target, 'tool.yaml'), 'utf8')).toBe('name: x');
  });

  it('commitStaging refuses to overwrite an existing target', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    fs.writeFileSync(path.join(staged, 'tool.yaml'), 'name: x');
    const target = layout.toolVersionDir('x.y', 1);
    fs.mkdirSync(target, { recursive: true });
    expect(() => layout.commitStaging(staged, target)).toThrow(/exists/);
  });

  it('cleanupStaging removes a directory silently', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    fs.writeFileSync(path.join(staged, 'f.txt'), 'hi');
    layout.cleanupStaging(staged);
    expect(fs.existsSync(staged)).toBe(false);
    layout.cleanupStaging(staged); // no throw on missing
  });
});

describe('hashToolDirectory', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-hash-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('produces a deterministic SHA-256 hex string', () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(tmpRoot, 'b.txt'), 'world');
    const h1 = hashToolDirectory(tmpRoot);
    const h2 = hashToolDirectory(tmpRoot);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when file contents change', () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello');
    const h1 = hashToolDirectory(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'HELLO');
    const h2 = hashToolDirectory(tmpRoot);
    expect(h1).not.toBe(h2);
  });

  it('changes when a file is added', () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello');
    const h1 = hashToolDirectory(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'b.txt'), 'new');
    const h2 = hashToolDirectory(tmpRoot);
    expect(h1).not.toBe(h2);
  });

  it('walks subdirectories deterministically', () => {
    fs.mkdirSync(path.join(tmpRoot, 'sub'));
    fs.writeFileSync(path.join(tmpRoot, 'sub', 'x.txt'), 'x');
    fs.writeFileSync(path.join(tmpRoot, 'top.txt'), 't');
    expect(hashToolDirectory(tmpRoot)).toMatch(/^[0-9a-f]{64}$/);
  });
});
