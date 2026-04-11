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

describe('RegistryClient — register', () => {
  let tmpRoot: string;
  let rc: RegistryClient;
  let sourceDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-reg-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-src-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, version: number): string {
    const dir = path.join(sourceDir, `${name}-v${version}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: ${name}
version: ${version}
description: fixture for tests
inputs:
  value:
    schema: Integer
    required: true
outputs:
  echoed:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(
      path.join(dir, 'tool.py'),
      'def run(value):\n    return {"echoed": value}\n',
    );
    return path.join(dir, 'tool.yaml');
  }

  it('registers a valid manifest and writes the version dir', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const result = await rc.register({ manifestPath, caller: 'human' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.toolName).toBe('test.echo_int');
    expect(result.version).toBe(1);
    expect(fs.existsSync(path.join(tmpRoot, 'tools', 'test.echo_int', 'v1', 'tool.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'tools', 'test.echo_int', 'v1', 'tool.py'))).toBe(true);
    expect(result.toolHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a manifest with parse errors', async () => {
    const bad = path.join(sourceDir, 'bad.yaml');
    fs.writeFileSync(bad, 'name: [unclosed');
    const result = await rc.register({ manifestPath: bad, caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('manifest_parse');
  });

  it('rejects a manifest referencing an unknown schema', async () => {
    const dir = path.join(sourceDir, 'badschema');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: x
version: 1
description: d
inputs:
  a:
    schema: Bogus
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(path.join(dir, 'tool.py'), 'def run(a):\n    return {"r": a}\n');
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.category === 'schema_unknown')).toBe(true);
  });

  it('rejects a duplicate (name, version)', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const first = await rc.register({ manifestPath, caller: 'human' });
    expect(first.success).toBe(true);
    const second = await rc.register({ manifestPath, caller: 'human' });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.errors[0].category).toBe('version_conflict');
  });

  it('rejects a manifest whose entry-point file is missing', async () => {
    const dir = path.join(sourceDir, 'noimpl');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: x
version: 1
description: d
inputs: {}
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    // No tool.py written.
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('entry_point_missing');
  });

  it('agent caller with testsRequired returns an internal stub error', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const result = await rc.register({ manifestPath, caller: 'agent', testsRequired: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('internal');
    expect(result.errors[0].message).toMatch(/not implemented/);
  });

  it('appends a success row to registration_log on success', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    await rc.register({ manifestPath, caller: 'human' });
    // Peek at the file-level log mirror.
    const logPath = path.join(tmpRoot, 'logs', 'registration.log');
    const logText = fs.readFileSync(logPath, 'utf8');
    expect(logText).toMatch(/test\.echo_int/);
    expect(logText).toMatch(/success/);
  });

  it('cleans up staging on failure', async () => {
    const bad = path.join(sourceDir, 'bad.yaml');
    fs.writeFileSync(bad, 'name: [unclosed');
    await rc.register({ manifestPath: bad, caller: 'human' });
    const stagingEntries = fs.readdirSync(path.join(tmpRoot, 'staging'));
    expect(stagingEntries).toEqual([]);
  });
});
