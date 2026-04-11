import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RegistryClient } from '../../registry-client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', '..', '__tests__', 'fixtures');

function pythonAvailable(): boolean {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

const numpyAvailable = ((): boolean => {
  if (!pythonAvailable()) return false;
  const r = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-c', 'import numpy'],
    { encoding: 'utf8' },
  );
  return r.status === 0;
})();

describe.skipIf(!pythonAvailable())('Executor — happy path (integration)', () => {
  let tmpRoot: string;
  let rc: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-exec-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns tool_not_found for a missing tool', async () => {
    const result = await rc.invoke({ toolName: 'missing', inputs: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('tool_not_found');
  });

  it('returns validation error when required input is missing', async () => {
    const reg = await rc.register({
      manifestPath: path.join(FIXTURES, 'echo_int', 'tool.yaml'),
      caller: 'human',
    });
    expect(reg.success).toBe(true);
    const result = await rc.invoke({ toolName: 'test.echo_int', inputs: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('validation');
    expect(result.error.message).toMatch(/value/);
  });

  it('invokes an integer echo tool end to end', async () => {
    const reg = await rc.register({
      manifestPath: path.join(FIXTURES, 'echo_int', 'tool.yaml'),
      caller: 'human',
    });
    expect(reg.success).toBe(true);
    const result = await rc.invoke({ toolName: 'test.echo_int', inputs: { value: 42 } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outputs).toEqual({ echoed: 42 });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!numpyAvailable)('invokes a numpy tool and returns opaque pickle envelope + float', async () => {
    const reg = await rc.register({
      manifestPath: path.join(FIXTURES, 'numpy_sum', 'tool.yaml'),
      caller: 'human',
    });
    expect(reg.success).toBe(true);
    const result = await rc.invoke({
      toolName: 'test.numpy_sum',
      inputs: { values: [1, 2, 3, 4] },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outputs.sum).toBeCloseTo(10, 5);
    const envelope = result.outputs.array as Record<string, unknown>;
    expect(envelope._schema).toBe('NumpyArray');
    expect(envelope._encoding).toBe('pickle_b64');
    expect(typeof envelope._data).toBe('string');
  });
});
