import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../yaml-parser.js';

const VALID_YAML = `
name: test-workflow
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
shared_context: "Test context"
nodes:
  ingestor:
    preset: data-ingestor
    kind: reasoning
  profiler:
    preset: data-profiler
    kind: reasoning
    depends_on: [ingestor]
  analyst:
    preset: analyst
    kind: reasoning
    depends_on: [profiler]
`;

describe('parseWorkflow', () => {
  it('parses valid workflow YAML', () => {
    const config = parseWorkflow(VALID_YAML);
    expect(config.name).toBe('test-workflow');
    expect(config.version).toBe(1);
    expect(config.config.max_total_tests).toBe(50);
    expect(Object.keys(config.nodes)).toHaveLength(3);
    expect(config.nodes.profiler.depends_on).toEqual(['ingestor']);
  });

  it('rejects missing name', () => {
    const yaml = VALID_YAML.replace('name: test-workflow', '');
    expect(() => parseWorkflow(yaml)).toThrow('Missing required field: "name"');
  });

  it('rejects missing agent_timeout_seconds', () => {
    const yaml = VALID_YAML.replace('agent_timeout_seconds: 300', '');
    expect(() => parseWorkflow(yaml)).toThrow('Missing required field: "agent_timeout_seconds"');
  });

  it('rejects unknown dependency', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    kind: reasoning
    depends_on: [nonexistent]
`;
    expect(() => parseWorkflow(yaml)).toThrow('depends on unknown node "nonexistent"');
  });

  it('rejects unknown branch target', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    kind: reasoning
    branch:
      - condition: "always"
        goto: nonexistent
`;
    expect(() => parseWorkflow(yaml)).toThrow('branches to unknown node "nonexistent"');
  });

  it('detects cycles without max_invocations', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    kind: reasoning
    depends_on: [b]
  b:
    preset: preset-b
    kind: reasoning
    depends_on: [a]
`;
    expect(() => parseWorkflow(yaml)).toThrow('Cycle detected');
  });

  it('defaults shared_context to empty string', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    kind: reasoning
`;
    const config = parseWorkflow(yaml);
    expect(config.shared_context).toBe('');
  });

  it('rejects node without preset', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    kind: reasoning
    depends_on: []
`;
    expect(() => parseWorkflow(yaml)).toThrow('must have a "preset" string');
  });
});

// ---- kind field tests ----

const VALID_YAML_WITH_KIND = `
name: kind-test
version: 1
config:
  agent_timeout_seconds: 300
shared_context: ""
nodes:
  reasoning_node:
    preset: some/preset
    kind: reasoning
  tool_node:
    preset: some/preset
    kind: tool
    tool: test.echo_int
    depends_on: [reasoning_node]
`;

describe('kind field validation', () => {
  it('accepts kind: reasoning on a node', () => {
    const yaml = `
name: t
version: 1
config:
  agent_timeout_seconds: 300
shared_context: ""
nodes:
  n:
    preset: p
    kind: reasoning
`;
    expect(() => parseWorkflow(yaml)).not.toThrow();
    const cfg = parseWorkflow(yaml);
    expect(cfg.nodes['n'].kind).toBe('reasoning');
  });

  it('accepts kind: tool with tool field present', () => {
    const cfg = parseWorkflow(VALID_YAML_WITH_KIND);
    expect(cfg.nodes['tool_node'].kind).toBe('tool');
    expect(cfg.nodes['tool_node'].tool).toBe('test.echo_int');
  });

  it('rejects node with missing kind field', () => {
    const yaml = `
name: t
version: 1
config:
  agent_timeout_seconds: 300
shared_context: ""
nodes:
  n:
    preset: p
`;
    expect(() => parseWorkflow(yaml)).toThrow("missing required field 'kind'");
  });

  it('rejects node with invalid kind value', () => {
    const yaml = `
name: t
version: 1
config:
  agent_timeout_seconds: 300
shared_context: ""
nodes:
  n:
    preset: p
    kind: agent
`;
    expect(() => parseWorkflow(yaml)).toThrow("invalid kind 'agent'");
  });

  it('rejects kind: tool node without tool field', () => {
    const yaml = `
name: t
version: 1
config:
  agent_timeout_seconds: 300
shared_context: ""
nodes:
  n:
    preset: p
    kind: tool
`;
    expect(() => parseWorkflow(yaml)).toThrow("tool field required");
  });

  it('parses toolset on reasoning nodes when present', () => {
    const yaml = `
name: t
version: 1
config:
  agent_timeout_seconds: 300
shared_context: ""
nodes:
  n:
    preset: p
    kind: reasoning
    toolset:
      - name: pandas.load_csv
      - category: math
`;
    const cfg = parseWorkflow(yaml);
    expect(cfg.nodes['n'].toolset).toEqual([
      { name: 'pandas.load_csv' },
      { category: 'math' },
    ]);
  });

  it('rejects invalid toolset entry (neither name nor category nor glob)', () => {
    const yaml = `
name: t
version: 1
config:
  agent_timeout_seconds: 300
shared_context: ""
nodes:
  n:
    preset: p
    kind: reasoning
    toolset:
      - invalid_field: something
`;
    expect(() => parseWorkflow(yaml)).toThrow();
  });
});
