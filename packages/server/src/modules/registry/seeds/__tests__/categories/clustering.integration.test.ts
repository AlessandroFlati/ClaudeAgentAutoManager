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
    const importName = lib === 'scikit-learn' ? 'sklearn' : lib === 'umap-learn' ? 'umap' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const LIBS = ['numpy', 'scikit-learn'];

describe('clustering seeds — integration', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-cluster-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
    await loadSeedTools(client);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sklearn.kmeans registers with correct category and output count',
    async () => {
      const tool = await client.get('sklearn.kmeans');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('clustering');
      expect(tool!.outputs).toHaveLength(3);
      const outNames = tool!.outputs.map((o) => o.name);
      expect(outNames).toContain('labels');
      expect(outNames).toContain('centroids');
      expect(outNames).toContain('inertia');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sklearn.dbscan registers with correct inputs and outputs',
    async () => {
      const tool = await client.get('sklearn.dbscan');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('clustering');
      expect(tool!.inputs).toHaveLength(3);
      expect(tool!.outputs).toHaveLength(2);
      const outNames = tool!.outputs.map((o) => o.name);
      expect(outNames).toContain('labels');
      expect(outNames).toContain('n_clusters');
    }
  );

  // Note: invocation tests for all clustering tools are NR2-gated.
  // Add invocation tests in the NR Phase 2 slice.
});
