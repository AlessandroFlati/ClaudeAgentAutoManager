import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { RegistryClient } from '../../../registry-client.js';
import { loadSeedTools } from '../../loader.js';

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

function libsAvailable(libs: string[]): boolean {
  if (!pythonAvailable()) return false;
  const cmd = (() => { const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']; for (const c of candidates) { try { const r = require('child_process').spawnSync(c, ['--version'], { encoding: 'utf8' }); if (r.status === 0) return c; } catch {} } return 'python'; })();
  for (const lib of libs) {
    const r = spawnSync(cmd, ['-c', `import ${lib}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const LIBS = ['numpy', 'scipy'];

describe('optimization seeds — integration', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-optim-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
    await loadSeedTools(client);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'scipy.minimize registers with func_name input port and correct output ports',
    async () => {
      const tool = client.get('scipy.minimize');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('optimization');
      const inputNames = tool!.inputs.map((i) => i.name);
      expect(inputNames).toContain('initial_guess');
      expect(inputNames).toContain('method');
      expect(inputNames).toContain('function');
      const funcNamePort = tool!.inputs.find((i) => i.name === 'function');
      expect(funcNamePort).toBeDefined();
      expect(funcNamePort!.schemaName).toBe('String');
      const outputNames = tool!.outputs.map((o) => o.name);
      expect(outputNames).toContain('x');
      expect(outputNames).toContain('fun');
      expect(outputNames).toContain('success');
      expect(outputNames).toContain('n_iter');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'scipy.linprog registers with correct input and output ports',
    async () => {
      const tool = client.get('scipy.linprog');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('optimization');
      const inputNames = tool!.inputs.map((i) => i.name);
      expect(inputNames).toContain('c');
      expect(inputNames).toContain('A_ub');
      expect(inputNames).toContain('b_ub');
      const outputNames = tool!.outputs.map((o) => o.name);
      expect(outputNames).toContain('x');
      expect(outputNames).toContain('fun');
      expect(outputNames).toContain('success');
    }
  );

  // Note: invocation tests for all optimization tools are NR2-gated.
  // Add invocation tests in the NR Phase 2 slice.
});
