import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorkflow } from '../yaml-parser.js';

const REPO_ROOT = join(__dirname, '../../../../../../');

function readWorkflow(name: string): string {
  return readFileSync(join(REPO_ROOT, 'workflows', name, 'workflow.yaml'), 'utf-8');
}

describe('Workflow YAML migration — kind: reasoning on all nodes', () => {
  it('math-discovery: all nodes have kind field and total count is correct', () => {
    const cfg = parseWorkflow(readWorkflow('math-discovery'));
    const nodeNames = Object.keys(cfg.nodes);
    expect(nodeNames.length).toBe(13);
    for (const name of nodeNames) {
      expect(cfg.nodes[name].kind, `node ${name} missing kind`).toBeDefined();
      expect(['reasoning', 'tool']).toContain(cfg.nodes[name].kind);
    }
    // All are reasoning in Phase 1
    for (const name of nodeNames) {
      expect(cfg.nodes[name].kind, `node ${name} should be reasoning`).toBe('reasoning');
    }
  });

  it('research-swarm: all 14 nodes have kind: reasoning', () => {
    const cfg = parseWorkflow(readWorkflow('research-swarm'));
    const nodeNames = Object.keys(cfg.nodes);
    expect(nodeNames.length).toBe(14);
    for (const name of nodeNames) {
      expect(cfg.nodes[name].kind, `node ${name} missing kind`).toBeDefined();
      expect(cfg.nodes[name].kind, `node ${name} should be reasoning`).toBe('reasoning');
    }
  });

  it('theorem-prover-mini: all 5 nodes have kind: reasoning', () => {
    const cfg = parseWorkflow(readWorkflow('theorem-prover-mini'));
    const nodeNames = Object.keys(cfg.nodes);
    expect(nodeNames.length).toBe(5);
    for (const name of nodeNames) {
      expect(cfg.nodes[name].kind, `node ${name} should be reasoning`).toBe('reasoning');
    }
  });
});
