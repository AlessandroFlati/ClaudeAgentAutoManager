import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DagExecutor } from '../dag-executor.js';
import { RegistryClient } from '../../registry/registry-client.js';
import type { WorkflowConfig } from '../types.js';

// Use __dirname — avoid import.meta.url for CJS compat
const FIXTURES = path.resolve(__dirname, '..', '..', 'registry', '__tests__', 'fixtures');

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
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', 'import numpy'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
})();

describe.skipIf(!pythonAvailable() || !numpyAvailable)(
  'DagExecutor — kind:tool two-node value_ref chain (integration)',
  () => {
    let tmpRoot: string;
    let workspacePath: string;
    let rc: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-tool-'));
      workspacePath = path.join(tmpRoot, 'workspace');
      fs.mkdirSync(workspacePath, { recursive: true });

      rc = new RegistryClient({ rootDir: path.join(tmpRoot, 'registry') });
      await rc.initialize();

      await rc.register({ manifestPath: path.join(FIXTURES, 'numpy_sum', 'tool.yaml'), caller: 'human' });
      await rc.register({ manifestPath: path.join(FIXTURES, 'numpy_identity', 'tool.yaml'), caller: 'human' });
    });

    afterEach(() => {
      rc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('node A produces value_ref signal; node B consumes it and produces its own value_ref', async () => {
      // Minimal workflow config with two tool nodes
      const workflowConfig: WorkflowConfig = {
        name: 'test-chain',
        config: { agent_timeout_seconds: 60 },
        nodes: {
          sum_node: {
            kind: 'tool',
            tool: 'test.numpy_sum',
            toolInputs: { values: [1, 2, 3, 4, 5] },
            depends_on: [],
          },
          id_node: {
            kind: 'tool',
            tool: 'test.numpy_identity',
            toolInputs: { arr: '${sum_node.outputs.array}' },
            depends_on: ['sum_node'],
          },
        },
        _yamlPath: '',
      } as unknown as WorkflowConfig;

      // We need stubs for AgentRegistry, AgentBootstrap, PresetRepository
      // Use minimal no-op stubs (same pattern as other dag-executor tests)
      const agentRegistry = { getAgentConfig: () => null } as unknown as import('../../agents/agent-registry.js').AgentRegistry;
      const bootstrap = { setCwd: () => {}, getSystemPrompt: async () => '' } as unknown as import('../../knowledge/agent-bootstrap.js').AgentBootstrap;
      const presetRepo = { findByPath: async () => null } as unknown as import('../../../db/preset-repository.js').PresetRepository;

      const executor = new DagExecutor(
        workflowConfig,
        workspacePath,
        tmpRoot,
        agentRegistry,
        bootstrap,
        presetRepo,
        rc,
      );

      let completed = false;
      executor.setCompleteHandler(() => { completed = true; });

      await executor.start();

      // Wait up to 15s for completion
      const deadline = Date.now() + 15_000;
      while (!completed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(completed).toBe(true);

      // Verify signal file for sum_node contains value_ref
      const runId = executor.runId;
      const signalDir = path.join(workspacePath, '.plurics', 'runs', runId, 'signals');
      const sumSignalPath = path.join(signalDir, 'sum_node.done.json');
      expect(fs.existsSync(sumSignalPath)).toBe(true);
      const sumSignal = JSON.parse(fs.readFileSync(sumSignalPath, 'utf-8'));
      const arrayOutput = sumSignal.outputs.find((o: Record<string, unknown>) =>
        (o['path'] as string).endsWith('/array'),
      );
      expect(arrayOutput).toBeDefined();
      expect(arrayOutput['value_ref']).toBeDefined();
      expect(typeof arrayOutput['value_ref']).toBe('string');
      expect(arrayOutput['summary']).toBeDefined();

      // Verify signal file for id_node also contains value_ref
      const idSignalPath = path.join(signalDir, 'id_node.done.json');
      expect(fs.existsSync(idSignalPath)).toBe(true);
      const idSignal = JSON.parse(fs.readFileSync(idSignalPath, 'utf-8'));
      const idOutput = idSignal.outputs.find((o: Record<string, unknown>) =>
        (o['path'] as string).endsWith('/arr'),
      );
      expect(idOutput).toBeDefined();
      expect(idOutput['value_ref']).toBeDefined();
    }, 20_000);
  },
);
