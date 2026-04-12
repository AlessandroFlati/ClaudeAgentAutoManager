import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../loader.js';

const FIXTURES = path.resolve(__dirname, 'fixtures');

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

describe.skipIf(!pythonAvailable() || !libsAvailable(['pandas', 'numpy']))(
  'loadSeedTools — primitive-input integration (requires Python + pandas + numpy)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;
    let tmpOut: string;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-int-'));
      tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-out-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(tmpOut, { recursive: true, force: true });
    });

    it('pandas.load_csv — loads CSV and returns a pickle_b64 DataFrame output', async () => {
      const csvPath = path.join(FIXTURES, 'sample.csv');
      const result = await client.invoke({
        toolName: 'pandas.load_csv',
        inputs: { path: csvPath },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs).toHaveProperty('df');
      const df = result.outputs['df'] as Record<string, unknown>;
      expect(df['_encoding']).toBe('pickle_b64');
      expect(df['_schema']).toBe('DataFrame');
    });

    it('json.load — loads JSON and returns a JsonObject', async () => {
      const jsonPath = path.join(FIXTURES, 'sample.json');
      const result = await client.invoke({
        toolName: 'json.load',
        inputs: { path: jsonPath },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const data = result.outputs['data'] as Record<string, unknown>;
      expect(data['key']).toBe('value');
      expect(data['n']).toBe(42);
    });

    it('json.dump — writes JSON to disk and returns written=true', async () => {
      const outPath = path.join(tmpOut, 'out.json');
      const result = await client.invoke({
        toolName: 'json.dump',
        inputs: { data: { answer: 42, label: 'test' }, path: outPath },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['written']).toBe(true);
      // Verify the file was actually written
      expect(fs.existsSync(outPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      expect(written['answer']).toBe(42);
    });

    it('stats.mean — returns arithmetic mean of [1,2,3,4,5] = 3.0', async () => {
      const result = await client.invoke({
        toolName: 'stats.mean',
        inputs: { values: [1, 2, 3, 4, 5] },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['mean']).toBe(3.0);
    });

    it('stats.fft — returns pickle_b64 NumpyArray envelopes for frequencies and magnitudes', async () => {
      const signal = [0, 1, 0, -1, 0, 1, 0, -1];
      const result = await client.invoke({
        toolName: 'stats.fft',
        inputs: { values: signal },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const freqs = result.outputs['frequencies'] as Record<string, unknown>;
      const mags = result.outputs['magnitudes'] as Record<string, unknown>;
      expect(freqs['_encoding']).toBe('pickle_b64');
      expect(mags['_encoding']).toBe('pickle_b64');
    });
  }
);
