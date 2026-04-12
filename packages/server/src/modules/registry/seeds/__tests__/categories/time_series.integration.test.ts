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
    const importName = lib === 'arch' ? 'arch' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const LIBS_STATSMODELS = ['numpy', 'statsmodels'];
const LIBS_TA = ['numpy', 'ta'];

describe('time_series seeds — integration', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-ts-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
    await loadSeedTools(client);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS_STATSMODELS))(
    'statsmodels.arima registers with correct category, inputs and outputs',
    async () => {
      const tool = await client.get('statsmodels.arima');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('time_series');
      expect(tool!.inputs).toHaveLength(3);
      const inNames = tool!.inputs.map((i) => i.name);
      expect(inNames).toContain('series');
      expect(inNames).toContain('order');
      expect(inNames).toContain('extra_params');
      expect(tool!.outputs).toHaveLength(5);
      const outNames = tool!.outputs.map((o) => o.name);
      expect(outNames).toContain('aic');
      expect(outNames).toContain('bic');
      expect(outNames).toContain('residuals');
      expect(outNames).toContain('fitted');
      expect(outNames).toContain('model');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS_TA))(
    'ta.compute_rsi registers with correct category, inputs and outputs',
    async () => {
      const tool = await client.get('ta.compute_rsi');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('time_series');
      expect(tool!.inputs).toHaveLength(2);
      const inNames = tool!.inputs.map((i) => i.name);
      expect(inNames).toContain('close');
      expect(inNames).toContain('period');
      expect(tool!.outputs).toHaveLength(1);
      expect(tool!.outputs[0].name).toBe('rsi');
      expect(tool!.outputs[0].schemaName).toBe('NumpyArray');
    }
  );

  // Note: invocation tests for all time_series tools are NR2-gated.
  // Add invocation tests in the NR Phase 2 slice.
});
