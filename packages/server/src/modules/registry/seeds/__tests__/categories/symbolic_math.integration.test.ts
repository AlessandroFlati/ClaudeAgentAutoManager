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
  const cmd = process.platform === 'win32' ? 'python' : 'python3';
  for (const lib of libs) {
    const importName = lib === 'scikit-learn' ? 'sklearn' : lib === 'umap-learn' ? 'umap' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const LIBS = ['sympy'];

describe('symbolic_math seeds — integration', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-symmath-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
    await loadSeedTools(client);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sympy.simplify registers with correct category and SymbolicExpr output',
    async () => {
      const tool = await client.get('sympy.simplify');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('symbolic_math');
      expect(tool!.inputs).toHaveLength(1);
      expect(tool!.inputs[0].name).toBe('expr');
      expect(tool!.inputs[0].schemaName).toBe('SymbolicExpr');
      expect(tool!.outputs).toHaveLength(1);
      expect(tool!.outputs[0].name).toBe('result');
      expect(tool!.outputs[0].schemaName).toBe('SymbolicExpr');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sympy.solve registers with JsonArray output (not SymbolicExpr)',
    async () => {
      const tool = await client.get('sympy.solve');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('symbolic_math');
      expect(tool!.inputs).toHaveLength(2);
      const inputNames = tool!.inputs.map((i) => i.name);
      expect(inputNames).toContain('expr');
      expect(inputNames).toContain('variable');
      expect(tool!.outputs).toHaveLength(1);
      expect(tool!.outputs[0].name).toBe('solutions');
      expect(tool!.outputs[0].schemaName).toBe('JsonArray');
    }
  );

  // Note: invocation tests for all symbolic_math tools are NR2-gated.
  // Add invocation tests in the NR Phase 2 slice.
});
