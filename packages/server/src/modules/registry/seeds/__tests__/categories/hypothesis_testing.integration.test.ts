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
    const importName = lib === 'scikit-learn' ? 'sklearn' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const SCIPY_LIBS = ['numpy', 'scipy'];
const STATSMODELS_LIBS = ['numpy', 'statsmodels'];

describe.skipIf(!pythonAvailable() || !libsAvailable(SCIPY_LIBS))(
  'hypothesis_testing seeds (scipy) — integration (requires Python + numpy + scipy)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-hyp-scipy-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('stats.t_test registers with correct port schemas', () => {
      const tool = client.get('stats.t_test');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('hypothesis_testing');
      const inputNames = tool!.inputs.map((p) => p.name);
      expect(inputNames).toContain('a');
      expect(inputNames).toContain('b');
      const inputSchemas = tool!.inputs.map((p) => p.schemaName);
      expect(inputSchemas).toEqual(['NumpyArray', 'NumpyArray']);
      const outputNames = tool!.outputs.map((p) => p.name);
      expect(outputNames).toContain('statistic');
      expect(outputNames).toContain('p_value');
    });

    it('stats.bootstrap_ci registers with correct port schemas', () => {
      const tool = client.get('stats.bootstrap_ci');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('hypothesis_testing');
      const inputNames = tool!.inputs.map((p) => p.name);
      expect(inputNames).toContain('data');
      expect(inputNames).toContain('confidence');
      expect(inputNames).toContain('n_resamples');
      const outputNames = tool!.outputs.map((p) => p.name);
      expect(outputNames).toContain('ci_low');
      expect(outputNames).toContain('ci_high');
    });

    it('stats.chi_square registers with dof output', () => {
      const tool = client.get('stats.chi_square');
      expect(tool).toBeDefined();
      const outputNames = tool!.outputs.map((p) => p.name);
      expect(outputNames).toContain('dof');
      const dofPort = tool!.outputs.find((p) => p.name === 'dof');
      expect(dofPort!.schemaName).toBe('Integer');
    });
  }
);

describe.skipIf(!pythonAvailable() || !libsAvailable(STATSMODELS_LIBS))(
  'hypothesis_testing seeds (statsmodels) — integration (requires Python + numpy + statsmodels)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-hyp-sm-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('stats.adf_test registers with critical_values output as JsonObject', () => {
      const tool = client.get('stats.adf_test');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('hypothesis_testing');
      const cvPort = tool!.outputs.find((p) => p.name === 'critical_values');
      expect(cvPort).toBeDefined();
      expect(cvPort!.schemaName).toBe('JsonObject');
    });

    it('stats.ljung_box registers with residuals + lags inputs', () => {
      const tool = client.get('stats.ljung_box');
      expect(tool).toBeDefined();
      const inputNames = tool!.inputs.map((p) => p.name);
      expect(inputNames).toContain('residuals');
      expect(inputNames).toContain('lags');
    });
  }
);
