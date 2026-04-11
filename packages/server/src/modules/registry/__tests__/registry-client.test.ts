import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../registry-client.js';
import { BUILTIN_SCHEMAS } from '../schemas/builtin.js';

describe('RegistryClient — lifecycle', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('initialize creates the directory layout and DB', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    expect(fs.existsSync(path.join(tmpRoot, 'tools'))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'registry.db'))).toBe(true);
    rc.close();
  });

  it('initialize populates the schemas table with built-ins', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    const names = rc.listSchemas().map((s) => s.name).sort();
    expect(names).toEqual([...BUILTIN_SCHEMAS.map((s) => s.name)].sort());
    rc.close();
  });

  it('getSchema returns a built-in schema by name', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    expect(rc.getSchema('Integer')?.encoding).toBe('json_literal');
    expect(rc.getSchema('NumpyArray')?.encoding).toBe('pickle_b64');
    expect(rc.getSchema('NotAThing')).toBeNull();
    rc.close();
  });

  it('initialize is idempotent', async () => {
    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    rc1.close();
    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    expect(rc2.listSchemas().length).toBe(BUILTIN_SCHEMAS.length);
    rc2.close();
  });

  it('close is idempotent', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    rc.close();
    rc.close();
  });
});
