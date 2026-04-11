import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryLayout } from '../filesystem.js';

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
