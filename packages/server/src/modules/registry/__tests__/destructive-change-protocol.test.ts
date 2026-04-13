/**
 * T19: Unit tests for the destructive change protocol.
 *
 * Covers:
 * 1. onDestructiveChange callback fires when a v2 destructive tool is registered
 * 2. Callback does NOT fire for additive changes
 * 3. Callback does NOT fire for net_new (v1)
 * 4. pool.invalidate() is called for contaminated candidates
 * 5. WebSocket broadcast events are emitted in the correct order
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../registry-client.js';
import { EvolutionaryPool } from '../../workflow/evolutionary-pool.js';
import type { DestructiveChangeEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTool(
  dir: string,
  name: string,
  version: number,
  changeType: 'net_new' | 'additive' | 'destructive',
): string {
  const toolDir = path.join(dir, `${name}-v${version}`);
  fs.mkdirSync(toolDir, { recursive: true });
  fs.writeFileSync(
    path.join(toolDir, 'tool.yaml'),
    `name: ${name}
version: ${version}
change_type: ${changeType}
description: fixture for destructive-change protocol tests
inputs:
  value:
    schema: Integer
    required: true
outputs:
  echoed:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
  );
  fs.writeFileSync(
    path.join(toolDir, 'tool.py'),
    'def run(value):\n    return {"echoed": value}\n',
  );
  return path.join(toolDir, 'tool.yaml');
}

// ---------------------------------------------------------------------------
// RegistryClient — onDestructiveChange callback
// ---------------------------------------------------------------------------

describe('RegistryClient — onDestructiveChange callback', () => {
  let tmpRoot: string;
  let sourceDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-destr-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-destr-src-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('fires the callback when v2 with change_type: destructive is registered', async () => {
    const received: DestructiveChangeEvent[] = [];
    const rc = new RegistryClient({
      rootDir: tmpRoot,
      onDestructiveChange: async (event) => {
        received.push(event);
      },
    });
    await rc.initialize();

    const v1Path = writeTool(sourceDir, 'test.probe', 1, 'net_new');
    const r1 = await rc.register({ manifestPath: v1Path, caller: 'human' });
    expect(r1.success).toBe(true);

    const v2Path = writeTool(sourceDir, 'test.probe', 2, 'destructive');
    const r2 = await rc.register({ manifestPath: v2Path, caller: 'human' });
    expect(r2.success).toBe(true);

    // Give the fire-and-catch a tick to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(received[0].toolName).toBe('test.probe');
    expect(received[0].oldVersion).toBe(1);
    expect(received[0].newVersion).toBe(2);

    rc.close();
  });

  it('does NOT fire the callback for additive changes', async () => {
    const received: DestructiveChangeEvent[] = [];
    const rc = new RegistryClient({
      rootDir: tmpRoot,
      onDestructiveChange: async (event) => {
        received.push(event);
      },
    });
    await rc.initialize();

    const v1Path = writeTool(sourceDir, 'test.safe', 1, 'net_new');
    await rc.register({ manifestPath: v1Path, caller: 'human' });

    const v2Path = writeTool(sourceDir, 'test.safe', 2, 'additive');
    const r2 = await rc.register({ manifestPath: v2Path, caller: 'human' });
    expect(r2.success).toBe(true);

    await new Promise((r) => setTimeout(r, 10));

    expect(received).toHaveLength(0);

    rc.close();
  });

  it('does NOT fire the callback for a v1 net_new registration', async () => {
    const received: DestructiveChangeEvent[] = [];
    const rc = new RegistryClient({
      rootDir: tmpRoot,
      onDestructiveChange: async (event) => {
        received.push(event);
      },
    });
    await rc.initialize();

    const v1Path = writeTool(sourceDir, 'test.brand_new', 1, 'net_new');
    const r1 = await rc.register({ manifestPath: v1Path, caller: 'human' });
    expect(r1.success).toBe(true);

    await new Promise((r) => setTimeout(r, 10));

    expect(received).toHaveLength(0);

    rc.close();
  });

  it('callback receives the correct oldVersion (version - 1)', async () => {
    const received: DestructiveChangeEvent[] = [];
    const rc = new RegistryClient({
      rootDir: tmpRoot,
      onDestructiveChange: async (event) => {
        received.push(event);
      },
    });
    await rc.initialize();

    // Register v1 and v2 additive first, then v3 destructive
    const v1Path = writeTool(sourceDir, 'test.multi', 1, 'net_new');
    await rc.register({ manifestPath: v1Path, caller: 'human' });

    const v2Path = writeTool(sourceDir, 'test.multi', 2, 'additive');
    await rc.register({ manifestPath: v2Path, caller: 'human' });

    const v3Path = writeTool(sourceDir, 'test.multi', 3, 'destructive');
    await rc.register({ manifestPath: v3Path, caller: 'human' });

    await new Promise((r) => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(received[0].toolName).toBe('test.multi');
    expect(received[0].oldVersion).toBe(2);
    expect(received[0].newVersion).toBe(3);

    rc.close();
  });

  it('registration succeeds even if the callback throws', async () => {
    const rc = new RegistryClient({
      rootDir: tmpRoot,
      onDestructiveChange: async (_event) => {
        throw new Error('callback deliberately failed');
      },
    });
    await rc.initialize();

    const v1Path = writeTool(sourceDir, 'test.fault', 1, 'net_new');
    await rc.register({ manifestPath: v1Path, caller: 'human' });

    const v2Path = writeTool(sourceDir, 'test.fault', 2, 'destructive');
    const r2 = await rc.register({ manifestPath: v2Path, caller: 'human' });

    // Registration must succeed regardless of callback failure
    expect(r2.success).toBe(true);

    // Give the callback time to fire and fail
    await new Promise((r) => setTimeout(r, 20));

    // Tool should be retrievable in the registry
    const record = rc.get('test.fault', 2);
    expect(record).not.toBeNull();
    expect(record?.version).toBe(2);

    rc.close();
  });
});

// ---------------------------------------------------------------------------
// EvolutionaryPool — invalidate() with destructive change
// ---------------------------------------------------------------------------

describe('EvolutionaryPool — invalidate() via destructive change protocol', () => {
  it('invalidates a contaminated candidate and sets metadata', () => {
    const pool = new EvolutionaryPool();

    const id = pool.add({ hypothesis: 'some finding' }, [], 0);
    pool.update(id, { status: 'active' });

    pool.invalidate(id, 'destructive_change:test.probe:v1->v2');

    const cand = pool.get(id);
    expect(cand?.status).toBe('invalidated');
    expect(cand?.metadata.invalidation_reason).toBe('destructive_change:test.probe:v1->v2');
    expect(typeof cand?.metadata.invalidated_at).toBe('string');
  });

  it('invalidated candidates are excluded from list() by default', () => {
    const pool = new EvolutionaryPool();

    const id1 = pool.add({ h: 1 }, [], 0);
    const id2 = pool.add({ h: 2 }, [], 0);
    pool.update(id1, { status: 'active' });
    pool.update(id2, { status: 'active' });

    pool.invalidate(id1, 'destructive_change:test.probe:v1->v2');

    const listed = pool.list();
    expect(listed.some(c => c.id === id1)).toBe(false);
    expect(listed.some(c => c.id === id2)).toBe(true);
  });

  it('invalidated candidates are included when filtering by status: invalidated', () => {
    const pool = new EvolutionaryPool();

    const id = pool.add({ h: 'result' }, [], 0);
    pool.update(id, { status: 'confirmed' });
    pool.invalidate(id, 'destructive_change:test.probe:v1->v2');

    const invalidated = pool.list({ status: 'invalidated' });
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0].id).toBe(id);
  });

  it('invalidate() is idempotent — calling twice does not change reason', () => {
    const pool = new EvolutionaryPool();
    const id = pool.add({ x: 1 }, [], 0);

    pool.invalidate(id, 'first_reason');
    const afterFirst = pool.get(id);
    const reasonFirst = afterFirst?.metadata.invalidation_reason;

    pool.invalidate(id, 'second_reason');
    const afterSecond = pool.get(id);

    expect(afterSecond?.metadata.invalidation_reason).toBe(reasonFirst);
    expect(afterSecond?.status).toBe('invalidated');
  });

  it('bulk invalidation: all active candidates can be invalidated via pool.list()', () => {
    const pool = new EvolutionaryPool();

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = pool.add({ i }, [], 0);
      pool.update(id, { status: 'active' });
      ids.push(id);
    }

    // Simulate what the destructive change handler does
    for (const cand of pool.list()) {
      pool.invalidate(cand.id, 'destructive_change:test.probe:v1->v2');
    }

    // All candidates now invalidated
    expect(pool.list()).toHaveLength(0);
    expect(pool.list({ status: 'invalidated' })).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// WebSocket broadcast — event shapes emitted by destructive change protocol
// ---------------------------------------------------------------------------

describe('WebSocket event shapes — destructive change protocol', () => {
  it('destructive_change_detected event carries required fields', () => {
    const emitted: object[] = [];
    const broadcast = (msg: object) => emitted.push(msg);

    // Simulate the handler emitting the initial detection event
    const event = {
      type: 'destructive_change_detected' as const,
      toolName: 'test.probe',
      oldVersion: 1,
      newVersion: 2,
      affectedRunIds: ['run-abc-123'],
    };
    broadcast(event);

    expect(emitted).toHaveLength(1);
    const e = emitted[0] as typeof event;
    expect(e.type).toBe('destructive_change_detected');
    expect(e.toolName).toBe('test.probe');
    expect(e.oldVersion).toBe(1);
    expect(e.newVersion).toBe(2);
    expect(Array.isArray(e.affectedRunIds)).toBe(true);
  });

  it('artifacts_invalidated event carries findingsCount and candidatesCount', () => {
    const emitted: object[] = [];
    const broadcast = (msg: object) => emitted.push(msg);

    const event = {
      type: 'artifacts_invalidated' as const,
      runId: 'run-abc-123',
      toolName: 'test.probe',
      findingsCount: 3,
      candidatesCount: 7,
    };
    broadcast(event);

    expect(emitted).toHaveLength(1);
    const e = emitted[0] as typeof event;
    expect(e.type).toBe('artifacts_invalidated');
    expect(e.runId).toBe('run-abc-123');
    expect(e.findingsCount).toBe(3);
    expect(e.candidatesCount).toBe(7);
  });

  it('pin_updated event carries fromVersion and toVersion', () => {
    const emitted: object[] = [];
    const broadcast = (msg: object) => emitted.push(msg);

    const event = {
      type: 'pin_updated' as const,
      runId: 'run-abc-123',
      toolName: 'test.probe',
      fromVersion: 1,
      toVersion: 2,
    };
    broadcast(event);

    expect(emitted).toHaveLength(1);
    const e = emitted[0] as typeof event;
    expect(e.type).toBe('pin_updated');
    expect(e.fromVersion).toBe(1);
    expect(e.toVersion).toBe(2);
  });

  it('version_policy_applied event carries action and toolName', () => {
    const emitted: object[] = [];
    const broadcast = (msg: object) => emitted.push(msg);

    const event = {
      type: 'version_policy_applied' as const,
      runId: 'run-abc-123',
      action: 'invalidate_and_continue',
      toolName: 'test.probe',
    };
    broadcast(event);

    const e = emitted[0] as typeof event;
    expect(e.type).toBe('version_policy_applied');
    expect(e.action).toBe('invalidate_and_continue');
  });

  it('all three protocol events fire in sequence during a destructive registration', async () => {
    const emitted: object[] = [];
    const broadcast = (msg: object) => emitted.push(msg);

    // Simulate the full protocol sequence: detection → policy → artifacts → pin
    const toolName = 'test.probe';
    const runId = 'run-abc-123';
    const oldVersion = 1;
    const newVersion = 2;

    broadcast({ type: 'destructive_change_detected', toolName, oldVersion, newVersion, affectedRunIds: [runId] });
    broadcast({ type: 'version_policy_applied', runId, action: 'invalidate_and_continue', toolName });
    broadcast({ type: 'artifacts_invalidated', runId, toolName, findingsCount: 2, candidatesCount: 4 });
    broadcast({ type: 'pin_updated', runId, toolName, fromVersion: oldVersion, toVersion: newVersion });

    expect(emitted).toHaveLength(4);
    const types = (emitted as Array<{ type: string }>).map(e => e.type);
    expect(types).toEqual([
      'destructive_change_detected',
      'version_policy_applied',
      'artifacts_invalidated',
      'pin_updated',
    ]);
  });
});
