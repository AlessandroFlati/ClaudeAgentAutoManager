# Q1 Version Policy and Destructive Change Protocol — Implementation Plan

**Date:** 2026-04-13
**Spec:** `docs/superpowers/specs/2026-04-13-q1-version-policy-design.md`
**Design refs:** `tool-registry.md` §8.2, §8.4 | `workflow-engine.md` §2.1, §8.3 | `evolutionary-pool.md` §2.1, §3.3 | `persistence.md` §4.1, §3.1, §5.1
**Estimated tasks:** 20

---

## Dependency graph

```
T01 → T02 → T03        (types chain)
T04 → T05 → T06        (parser → validator → registration)
T03 + T06 → T07        (DB migration depends on types + registration)
T01 + T03 → T08        (yaml-parser depends on types)
T03 + T08 → T09        (dag-executor resolveToolVersions depends on types + parser)
T09 → T10              (dispatch version pin depends on resolve)
T07 + T09 → T11        (invocation logging depends on DB migration + executor)
T11 → T12              (destructive protocol depends on invocation log)
T12 → T13              (resume check depends on protocol)
T14                    (evolutionary pool — independent of others except T01 for CandidateStatus awareness)
T15 → T16              (WebSocket events depend on protocol)
T11 + T15 → T17        (app.ts wiring depends on invocation log + events)
T01–T17 → T18          (tests)
T18 → T19              (seed tool yaml update)
T19 → T20              (verification)
```

---

## Task T01 — Add `ChangeType` and extend `ToolManifest` / `ToolRecord`

**File:** `packages/server/src/modules/registry/types.ts`

**What:**
1. Add `export type ChangeType = 'net_new' | 'additive' | 'destructive';` after the existing type exports.
2. Add `change_type: ChangeType;` to `ToolManifest` (after the `version` field).
3. Add `changeType: ChangeType;` to `ToolRecord` (after `createdAt`).

**Constraints:**
- `change_type` (snake_case) in `ToolManifest` — matches YAML convention.
- `changeType` (camelCase) in `ToolRecord` — matches existing JS conventions (`toolHash`, `costClass`).
- Do not touch any other types in this file.

**Verification:** TypeScript compilation errors will identify every place these types are used before they are populated.

---

## Task T02 — Parse `change_type` in manifest parser

**File:** `packages/server/src/modules/registry/manifest/parser.ts`

**What:**
1. Import `ChangeType` from `'../types.js'`.
2. Add `const VALID_CHANGE_TYPES = new Set<string>(['net_new', 'additive', 'destructive']);` at module scope.
3. After the `version` parse line in `parseToolManifest()`, add:

```typescript
const rawChangeType = doc.change_type;
if (rawChangeType === undefined || rawChangeType === null) {
  throw new ManifestParseError('change_type is required', 'change_type');
}
if (typeof rawChangeType !== 'string' || !VALID_CHANGE_TYPES.has(rawChangeType)) {
  throw new ManifestParseError(
    `change_type must be one of net_new|additive|destructive (got "${String(rawChangeType)}")`,
    'change_type',
  );
}
manifest.change_type = rawChangeType as ChangeType;
```

4. Add `change_type: rawChangeType as ChangeType` to the `manifest` object literal (currently constructed just before the optional field assignments).

**Constraints:**
- Fail fast: no default, no silent fallback. Any manifest without `change_type` is a parse error.
- The existing `asString` helper should NOT be used here (we want the `VALID_CHANGE_TYPES` check bundled in the same block for clarity).

**Verification:** Run `packages/server/src/modules/registry/manifest/__tests__/parser.test.ts`. Add three new test cases: missing `change_type`, invalid `change_type`, valid values.

---

## Task T03 — Validate `change_type` cross-field rules in manifest validator

**File:** `packages/server/src/modules/registry/manifest/validator.ts`

**What:**
After the version range check, add:

```typescript
// Rule: version 1 must be net_new; versions > 1 cannot be net_new
if (manifest.version === 1 && manifest.change_type !== 'net_new') {
  errors.push({
    category: 'manifest_validation',
    message: `version 1 tools must declare change_type: net_new (got "${manifest.change_type}")`,
    path: 'change_type',
  });
}
if (manifest.version > 1 && manifest.change_type === 'net_new') {
  errors.push({
    category: 'manifest_validation',
    message: `change_type: net_new is only valid for version 1 (got version ${manifest.version})`,
    path: 'change_type',
  });
}
```

**Constraints:**
- Push to `errors`, do not throw. The validator accumulates errors.
- No new imports needed.

**Verification:** Run `packages/server/src/modules/registry/manifest/__tests__/validator.test.ts`. Add tests for both forbidden combinations.

---

## Task T04 — SQL migration v2→v3: `change_type` column + `tool_invocations` table

**File:** `packages/server/src/modules/registry/storage/db.ts`

**What:**
1. Change `const EXPECTED_SCHEMA_VERSION = 2;` to `3`.
2. In `applyMigrations(currentVersion)`, add:

```typescript
if (currentVersion < 3) {
  db.exec(`
    ALTER TABLE tools ADD COLUMN change_type TEXT NOT NULL DEFAULT 'net_new';

    CREATE TABLE IF NOT EXISTS tool_invocations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp    TEXT    NOT NULL,
      tool_name    TEXT    NOT NULL,
      tool_version INTEGER NOT NULL,
      run_id       TEXT,
      node_name    TEXT,
      scope        TEXT,
      duration_ms  INTEGER,
      success      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_inv_run  ON tool_invocations(run_id);
    CREATE INDEX IF NOT EXISTS idx_tool_inv_tool ON tool_invocations(tool_name, tool_version);
  `);
}
```

3. In `insertTool()`, add `change_type` to the INSERT column list and bind `manifest.change_type`.
4. In `rowToRecord()`, add `changeType: row.change_type as ChangeType` to the returned `ToolRecord`.
5. Add `ToolInvocationRow` interface and `insertToolInvocation(row)` + `getRunInvocations(runId)` methods.

```typescript
export interface ToolInvocationRow {
  toolName: string;
  toolVersion: number;
  runId: string | null;
  nodeName: string | null;
  scope: string | null;
  durationMs: number | null;
  success: boolean;
}

insertToolInvocation(row: ToolInvocationRow): void {
  this.raw().prepare(`
    INSERT INTO tool_invocations
      (timestamp, tool_name, tool_version, run_id, node_name, scope, duration_ms, success)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?)
  `).run(row.toolName, row.toolVersion, row.runId, row.nodeName, row.scope, row.durationMs, row.success ? 1 : 0);
}

getRunInvocations(runId: string): ToolInvocationRow[] {
  return (this.raw().prepare(
    'SELECT * FROM tool_invocations WHERE run_id = ?'
  ).all(runId) as Array<Record<string, unknown>>).map(r => ({
    toolName: r.tool_name as string,
    toolVersion: r.tool_version as number,
    runId: r.run_id as string | null,
    nodeName: r.node_name as string | null,
    scope: r.scope as string | null,
    durationMs: r.duration_ms as number | null,
    success: (r.success as number) === 1,
  }));
}

getToolInvocationsForVersion(toolName: string, toolVersion: number): Array<{ runId: string | null; nodeName: string | null }> {
  return (this.raw().prepare(
    'SELECT run_id, node_name FROM tool_invocations WHERE tool_name = ? AND tool_version = ?'
  ).all(toolName, toolVersion) as Array<Record<string, unknown>>).map(r => ({
    runId: r.run_id as string | null,
    nodeName: r.node_name as string | null,
  }));
}
```

**Constraints:**
- `ALTER TABLE` will fail if the column already exists (e.g., migration applied twice). Wrap in a try-catch or check `sqlite_master` first. Safest: add `PRAGMA table_info(tools)` check before `ALTER TABLE`, or use `ALTER TABLE tools ADD COLUMN ... DEFAULT 'net_new'` which is idempotent on SQLite (it fails with "duplicate column" — catch and ignore).
- Use `CREATE TABLE IF NOT EXISTS` for the new table.

**Verification:** Run `packages/server/src/modules/registry/storage/__tests__/db.test.ts`. Confirm migration runs without error on a fresh DB and on a v2 DB. Confirm `change_type` column exists and `tool_invocations` table exists after migration.

---

## Task T05 — Log tool invocations in `RegistryClient.invoke()`

**File:** `packages/server/src/modules/registry/registry-client.ts`

**What:**
In `invoke()`, after resolving the tool version and after receiving the result, call `this.db.insertToolInvocation()`:

```typescript
if (request.callerContext?.workflowRunId) {
  this.db.insertToolInvocation({
    toolName: request.toolName,
    toolVersion: resolvedVersion,
    runId: request.callerContext.workflowRunId,
    nodeName: request.callerContext.nodeName,
    scope: request.callerContext.scope ?? null,
    durationMs: result.metrics.durationMs,
    success: result.success,
  });
}
```

Log on both success and failure — the protocol needs to identify contaminated invocations regardless of outcome.

`resolvedVersion` is the concrete version used (already resolved inside `invoke()` when `version` is `undefined`). Verify which variable name holds this value in the current code — read `registry-client.ts` lines around the `invokeTool` call before editing.

**Constraints:**
- Invocation logging is best-effort: wrap in try-catch, log error to console but do not fail the invocation.
- Do not log when `callerContext` is absent (test invocations, seed loading).

**Verification:** Run `packages/server/src/modules/registry/__tests__/registry-client.test.ts`. Add a test that checks `tool_invocations` rows after a successful invocation with `callerContext`.

---

## Task T06 — Add `VersionPolicy` types and `DEFAULT_VERSION_POLICY` to workflow types

**File:** `packages/server/src/modules/workflow/types.ts`

**What:**
After the existing type definitions (before `WorkflowConfig`), add:

```typescript
export type VersionResolution = 'pin_at_start' | 'always_latest';
export type DestructiveChangeAction = 'invalidate_and_continue' | 'abort' | 'ignore';
export type InvalidationScope = 'contaminated' | 'all_findings' | 'all_candidates';

export interface VersionPolicy {
  resolution: VersionResolution;
  dynamic_tools: string[];
  on_destructive_change: {
    action: DestructiveChangeAction;
    scope: InvalidationScope | InvalidationScope[];
  };
}

export const DEFAULT_VERSION_POLICY: VersionPolicy = {
  resolution: 'pin_at_start',
  dynamic_tools: [],
  on_destructive_change: {
    action: 'invalidate_and_continue',
    scope: 'contaminated',
  },
};
```

Extend `WorkflowConfig`:

```typescript
export interface WorkflowConfig {
  name: string;
  version: number;
  version_policy?: VersionPolicy;    // optional; DEFAULT_VERSION_POLICY applied at runtime
  plugin?: string;
  _yamlPath?: string;
  _resolved_tools?: Record<string, number>;  // set by DagExecutor.start(), not from YAML
  config: Record<string, unknown> & { /* existing */ };
  shared_context: string;
  nodes: Record<string, WorkflowNodeDef>;
}
```

**Constraints:**
- `version_policy` is optional in the interface (`?`) because existing tests construct `WorkflowConfig` objects without it.
- `_resolved_tools` has a leading underscore to signal it is runtime-set, not YAML-parsed.
- Do not change `WorkflowNodeDef`.

**Verification:** TypeScript compilation passes. Existing tests pass without modification.

---

## Task T07 — Parse `version_policy` in `yaml-parser.ts`

**File:** `packages/server/src/modules/workflow/yaml-parser.ts`

**What:**
1. Import `VersionPolicy`, `DEFAULT_VERSION_POLICY`, and the relevant union types from `'./types.js'`.
2. Add `parseVersionPolicy(raw: unknown, path: string): VersionPolicy` function:

```typescript
function parseVersionPolicy(raw: unknown, path: string): VersionPolicy {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`"${path}" must be a mapping`);
  }
  const r = raw as Record<string, unknown>;

  let resolution: VersionResolution = 'pin_at_start';
  if (r.resolution !== undefined) {
    if (r.resolution !== 'pin_at_start' && r.resolution !== 'always_latest') {
      throw new Error(`"${path}.resolution" must be pin_at_start|always_latest (got "${r.resolution}")`);
    }
    resolution = r.resolution as VersionResolution;
  }

  let dynamic_tools: string[] = [];
  if (r.dynamic_tools !== undefined) {
    if (!Array.isArray(r.dynamic_tools) || r.dynamic_tools.some(p => typeof p !== 'string')) {
      throw new Error(`"${path}.dynamic_tools" must be a list of strings`);
    }
    dynamic_tools = r.dynamic_tools as string[];
  }

  let action: DestructiveChangeAction = 'invalidate_and_continue';
  let scope: InvalidationScope | InvalidationScope[] = 'contaminated';
  const odc = r.on_destructive_change;
  if (odc !== undefined) {
    if (typeof odc !== 'object' || odc === null) {
      throw new Error(`"${path}.on_destructive_change" must be a mapping`);
    }
    const odcr = odc as Record<string, unknown>;
    if (odcr.action !== undefined) {
      const VALID_ACTIONS = ['invalidate_and_continue', 'abort', 'ignore'];
      if (!VALID_ACTIONS.includes(odcr.action as string)) {
        throw new Error(`"${path}.on_destructive_change.action" must be one of ${VALID_ACTIONS.join('|')}`);
      }
      action = odcr.action as DestructiveChangeAction;
    }
    if (odcr.scope !== undefined) {
      const VALID_SCOPES = ['contaminated', 'all_findings', 'all_candidates'];
      if (Array.isArray(odcr.scope)) {
        if (odcr.scope.some(s => !VALID_SCOPES.includes(s as string))) {
          throw new Error(`"${path}.on_destructive_change.scope" entries must be one of ${VALID_SCOPES.join('|')}`);
        }
        scope = odcr.scope as InvalidationScope[];
      } else {
        if (!VALID_SCOPES.includes(odcr.scope as string)) {
          throw new Error(`"${path}.on_destructive_change.scope" must be one of ${VALID_SCOPES.join('|')}`);
        }
        scope = odcr.scope as InvalidationScope;
      }
    }
  }

  return { resolution, dynamic_tools, on_destructive_change: { action, scope } };
}
```

3. In `parseWorkflow()`, after reading `raw.shared_context`, add:

```typescript
if (raw.version_policy != null) {
  raw.version_policy = parseVersionPolicy(raw.version_policy, 'version_policy');
}
```

**Constraints:**
- Missing `version_policy` in the YAML yields `undefined` in `WorkflowConfig.version_policy`. Consumers must always use `version_policy ?? DEFAULT_VERSION_POLICY`.
- Throw on unrecognized values; do not silently ignore.

**Verification:** Run `packages/server/src/modules/workflow/__tests__/yaml-parser.test.ts`. Add tests for: missing `version_policy` (should pass), valid `version_policy`, invalid `resolution`, invalid `scope`, scope as list.

---

## Task T08 — Add `minimatch` dependency

**File:** `packages/server/package.json`

**What:**
Check if `minimatch` is already present:

```bash
grep minimatch packages/server/package.json
```

If absent, add `"minimatch": "^9.0.0"` to `dependencies` and run `npm install` in `packages/server/`.

Create `packages/server/src/modules/workflow/glob-match.ts`:

```typescript
import { minimatch } from 'minimatch';

/** Returns true if toolName matches any of the provided glob patterns. */
export function matchesAnyGlob(toolName: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some(p => minimatch(toolName, p, { dot: true }));
}
```

**Verification:** Unit test: `matchesAnyGlob('custom.foo', ['custom.*'])` returns `true`; `matchesAnyGlob('stats.adf_test', ['custom.*'])` returns `false`.

---

## Task T09 — Version resolution at parse time in `DagExecutor.start()`

**File:** `packages/server/src/modules/workflow/dag-executor.ts`

**What:**
1. Import `DEFAULT_VERSION_POLICY` and `matchesAnyGlob` at the top.
2. Add private method `resolveToolVersions()`:

```typescript
private async resolveToolVersions(): Promise<Record<string, number>> {
  const policy = this.workflowConfig.version_policy ?? DEFAULT_VERSION_POLICY;
  if (!this.registryClient) return {};
  if (policy.resolution !== 'pin_at_start') return {};

  const resolved: Record<string, number> = {};
  for (const [nodeName, nodeDef] of Object.entries(this.workflowConfig.nodes)) {
    if (nodeDef.kind !== 'tool' || !nodeDef.tool) continue;
    const toolName = nodeDef.tool;
    if (matchesAnyGlob(toolName, policy.dynamic_tools)) continue;
    const record = await this.registryClient.getLatest(toolName);
    if (!record) {
      throw new Error(`Tool "${toolName}" not found in registry (referenced by node "${nodeName}")`);
    }
    if (!(toolName in resolved)) {
      resolved[toolName] = record.version;
    }
  }
  return resolved;
}
```

3. In `start()`, after the type-checker call (search for `checkWorkflow`) and before `this.buildNodeGraph()`, add:

```typescript
const resolvedTools = await this.resolveToolVersions();
this.workflowConfig._resolved_tools = resolvedTools;
```

4. In the `run-metadata.json` write, add `resolved_tools: resolvedTools` to the object.

**Constraints:**
- `registryClient.getLatest(toolName)` must be a method on `RegistryClient`. Read `registry-client.ts` to confirm the existing method signature; if it is named differently, use the correct name.
- A tool may appear in multiple nodes; only resolve it once (the `if (!(toolName in resolved))` guard).
- If `registryClient` is null (test mode), return `{}` without error.

**Verification:** Run `packages/server/src/modules/workflow/__tests__/dag-executor-tool-nodes.test.ts`. Add test confirming `run-metadata.json` contains `resolved_tools` with correct versions.

---

## Task T10 — Pin resolved version at dispatch time in `dispatchToolNode`

**File:** `packages/server/src/modules/workflow/dag-executor.ts`

**What:**
1. Add private method `resolveToolVersion(toolName: string): number | undefined`:

```typescript
private resolveToolVersion(toolName: string): number | undefined {
  const policy = this.workflowConfig.version_policy ?? DEFAULT_VERSION_POLICY;
  if (matchesAnyGlob(toolName, policy.dynamic_tools)) return undefined;
  if (policy.resolution === 'pin_at_start') {
    return this.workflowConfig._resolved_tools?.[toolName];
  }
  return undefined;  // always_latest: let registry resolve
}
```

2. In the tool node dispatch path (where `InvocationRequest` is built), set:

```typescript
version: this.resolveToolVersion(node.tool!),
```

Read the current `dispatchToolNode` logic first to identify the exact location.

**Constraints:**
- `version: undefined` in `InvocationRequest` means the registry uses `latest` — this is already how the registry works.
- Do not change how converters are dispatched; converters are not in `resolved_tools`.

**Verification:** Existing `dag-executor-tool-nodes` tests. Add one test: a tool node with a pinned version dispatches with that specific version.

---

## Task T11 — `invalidated` status and `invalidate()` method in `EvolutionaryPool`

**File:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**What:**
1. Add `'invalidated'` to `CandidateStatus`:

```typescript
export type CandidateStatus =
  | 'pending_evaluation'
  | 'active'
  | 'confirmed'
  | 'falsified'
  | 'pruned'
  | 'archived'
  | 'invalidated';
```

2. Add `invalidate(id: string, reason: string): void` method after `updateStatus`:

```typescript
invalidate(id: string, reason: string): void {
  const existing = this.candidates.get(id);
  if (!existing) throw new Error(`Candidate not found: ${id}`);
  if (existing.status === 'invalidated') return;  // idempotent
  this.candidates.set(id, {
    ...existing,
    status: 'invalidated',
    metadata: {
      ...existing.metadata,
      invalidation_reason: reason,
      invalidated_at: new Date().toISOString(),
    },
    updatedAt: Date.now(),
  });
}
```

3. Modify `list()` to exclude `invalidated` by default:

Read the current `list()` implementation first. If it currently returns all candidates, change the base filter:

```typescript
list(filters?: PoolFilters): PoolCandidate[] {
  let candidates = [...this.candidates.values()];
  // Exclude invalidated unless explicitly requested via status filter
  if (filters?.status === undefined) {
    candidates = candidates.filter(c => c.status !== 'invalidated');
  }
  // ... apply remaining filters (status, generation, fitness, etc.)
}
```

4. Verify `select()` default `statusFilter` does not include `invalidated` (it should not — check the existing list of eligible statuses).

5. Update `PoolStats.byStatus` to include `invalidated: 0` in the initial accumulator in `stats()` so the count is always present.

**Constraints:**
- Do not touch `snapshot()` / `restore()` — `invalidated` candidates must persist as-is.
- `invalidate()` on a `pruned` or `archived` candidate: allow it (the design doc says "from any non-terminal state and from confirmed/falsified"). The only terminal that should block is `invalidated` itself (already handled by the idempotent guard).

**Verification:** Run `packages/server/src/modules/workflow/__tests__/evolutionary-pool.test.ts`. Add tests for: `invalidate()` transitions, idempotency, exclusion from `list()`, inclusion when `status: 'invalidated'` filter is passed.

---

## Task T12 — Add `onDestructiveChange` callback to `RegistryClientOptions`

**File:** `packages/server/src/modules/registry/types.ts`

**What:**
Add to `RegistryClientOptions`:

```typescript
export interface DestructiveChangeEvent {
  toolName: string;
  oldVersion: number;
  newVersion: number;
}

export interface RegistryClientOptions {
  rootDir?: string;
  pythonPath?: string;
  onDestructiveChange?: (event: DestructiveChangeEvent) => Promise<void>;
}
```

**File:** `packages/server/src/modules/registry/registry-client.ts`

**What:**
1. Store `options.onDestructiveChange` in `private readonly onDestructiveChange`.
2. In `register()`, after a successful registration, check if the registered tool has `change_type: destructive` and if `manifest.version > 1`:

```typescript
if (manifest.change_type === 'destructive' && manifest.version > 1 && this.onDestructiveChange) {
  await this.onDestructiveChange({
    toolName: manifest.name,
    oldVersion: manifest.version - 1,
    newVersion: manifest.version,
  }).catch(err => {
    console.error('[registry] destructive change protocol error:', err);
  });
}
```

The callback is fire-and-catch: a protocol failure must not roll back the registration.

**Constraints:**
- `oldVersion = manifest.version - 1` is a simplification: the previous latest version. If the registry has v1 and v3 (v2 was skipped somehow), this is wrong. In practice the registry enforces sequential versioning (`version_conflict` error). Accept the simplification for MVP.
- The callback is optional: if not provided, the protocol is silently skipped.

**Verification:** Unit test in `registry-client.test.ts`: register a v2 tool with `change_type: destructive`, confirm the callback is called with correct args.

---

## Task T13 — Implement `handleDestructiveChange` in `app.ts`

**File:** `packages/server/src/app.ts`

**What:**
In the `RegistryClient` construction (find where `new RegistryClient(...)` is called), pass an `onDestructiveChange` callback:

```typescript
const registryClient = new RegistryClient({
  // ... existing options
  onDestructiveChange: async (event) => {
    await handleDestructiveChange(event, db, workspacePath, websocketBroadcast);
  },
});
```

Implement `handleDestructiveChange(event, db, workspacePath, broadcast)` as a standalone function in `app.ts` (or a new file `workflow/destructive-change-handler.ts` if `app.ts` is already large — read its current size first):

```
handleDestructiveChange(event, db, workspacePath, broadcast):
  1. Query plurics.db: SELECT id, yaml_content, workspace_path FROM workflow_runs
     WHERE status IN ('running', 'interrupted')
  2. For each run:
     a. Query tool_invocations in registry.db:
        SELECT COUNT(*) FROM tool_invocations
        WHERE run_id = run.id AND tool_name = event.toolName AND tool_version = event.oldVersion
        → if 0 rows: not affected, skip
     b. runDir = path.join(run.workspace_path, '.plurics', 'runs', run.id)
     c. Load version_policy from workflow.yaml.snapshot OR parse from run.yaml_content
     d. Apply on_destructive_change.action:
        - 'abort': write abort-record.json, update workflow_runs.status = 'aborted_due_to_destructive_change', emit events
        - 'ignore': append warning to run log, emit event
        - 'invalidate_and_continue': proceed
     e. For 'invalidate_and_continue':
        - Load pool-state.json
        - Determine contaminated nodes using DAG + invocation log
        - Call pool.invalidate(candidateId, reason) for each contaminated candidate
        - Write pool-state.json (atomic)
        - Update run-metadata.json resolved_tools entry (atomic)
        - Emit events: destructive_change_detected, artifacts_invalidated, pin_updated
  3. Broadcast WebSocket events for each affected run
```

**Loading `version_policy`:**
- Primary: read `workflowDir/workflow.yaml.snapshot` if present.
- Fallback: parse `run.yaml_content` from the DB row.
- If neither has `version_policy`, use `DEFAULT_VERSION_POLICY`.

**Contaminated node determination (scope: contaminated):**
- Parse the workflow DAG from the yaml snapshot.
- Find all nodes that invoked `event.toolName` at `event.oldVersion`: query `tool_invocations WHERE run_id = ? AND tool_name = ? AND tool_version = ?`, get distinct `node_name` values.
- BFS over DAG from each source node, collecting all reachable downstream node names.
- Contaminated set = source nodes + downstream nodes.
- In pool-state.json, a candidate's `metadata.node_name` or `metadata.produced_by` identifies its producing node. Mark candidates produced by contaminated nodes.

**Constraints:**
- Read `app.ts` before editing — understand its current structure (imports, initialization, WebSocket setup).
- The `workspacePath` used for run directories may differ from the server's CWD. Use `run.workspace_path` from the DB row.
- Atomic writes: use `writeJsonAtomic` from `workflow/utils.ts`.
- If `pool-state.json` does not exist (pool never snapshotted), skip pool invalidation — no candidates to invalidate.
- If `run-metadata.json` cannot be read, log error and continue (protocol should not crash on partial state).

**Verification:** Integration test (manual or automated): register a v2 destructive tool while a workflow run exists in the DB with a pool snapshot that references v1 of that tool. Confirm pool-state.json is updated and run-metadata.json resolved_tools is updated.

---

## Task T14 — Destructive change check in `DagExecutor.resumeFrom()`

**File:** `packages/server/src/modules/workflow/dag-executor.ts`

**What:**
After "Load evolutionary pool snapshot" and before "Rebuild node graph from snapshot", add:

```typescript
// Step 4: check for destructive changes that occurred while interrupted
const metaPath = path.join(runDir, 'run-metadata.json');
let resolvedTools: Record<string, number> = {};
try {
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as { resolved_tools?: Record<string, number> };
  resolvedTools = meta.resolved_tools ?? {};
} catch { /* no metadata — skip check */ }

if (this.registryClient && Object.keys(resolvedTools).length > 0) {
  await this.applyDestructiveChangesAtResume(resolvedTools, runDir);
}
```

Add private method `applyDestructiveChangesAtResume(resolvedTools, runDir)`:

```typescript
private async applyDestructiveChangesAtResume(
  resolvedTools: Record<string, number>,
  runDir: string,
): Promise<void> {
  const policy = this.workflowConfig.version_policy ?? DEFAULT_VERSION_POLICY;
  for (const [toolName, pinnedVersion] of Object.entries(resolvedTools)) {
    const latest = await this.registryClient!.getLatest(toolName);
    if (!latest || latest.version <= pinnedVersion) continue;
    // Check each intermediate version for destructive flag
    for (let v = pinnedVersion + 1; v <= latest.version; v++) {
      const record = await this.registryClient!.getVersion(toolName, v);
      if (!record) continue;
      if (record.changeType === 'destructive') {
        // Apply policy — same logic as the running protocol
        // Re-use the onDestructiveChange callback indirectly via the same handler
        // OR apply inline for resume path
        if (policy.on_destructive_change.action === 'abort') {
          throw new Error(
            `Resume aborted: tool "${toolName}" received destructive change (v${pinnedVersion}→v${v}). ` +
            `version_policy.on_destructive_change.action is "abort".`
          );
        } else if (policy.on_destructive_change.action === 'ignore') {
          console.warn(`[resume] ignoring destructive change in ${toolName} v${pinnedVersion}→v${v}`);
        } else {
          // invalidate_and_continue — update pin in metadata and in-memory
          const meta = JSON.parse(await fs.readFile(path.join(runDir, 'run-metadata.json'), 'utf-8'));
          meta.resolved_tools[toolName] = v;
          await writeJsonAtomic(path.join(runDir, 'run-metadata.json'), meta);
          this.workflowConfig._resolved_tools = { ...this.workflowConfig._resolved_tools, [toolName]: v };
          // Pool invalidation: handled if pool was already loaded above
          // Mark contaminated candidates via pool.invalidate()
          // (contaminated node analysis is best-effort at resume — use all_candidates if no invocation log)
          // For MVP: invalidate all candidates whose metadata references the tool
          for (const cand of this.pool.list({ status: ['pending_evaluation', 'active', 'confirmed'] as any })) {
            this.pool.invalidate(
              cand.id,
              `destructive_change_in_tool:${toolName}:${pinnedVersion}→${v}`
            );
          }
        }
        break;  // once a destructive version is found, no need to check further
      }
    }
  }
}
```

Note: `registryClient.getVersion(toolName, version)` may not exist yet — check `registry-client.ts`. If it doesn't exist, add it (see T15).

**Constraints:**
- Resume with `action: abort` must throw, leaving the run `interrupted`. The caller (`run-controller.ts` or `app.ts`) must catch this and NOT transition the run to any other state.
- For MVP, the contamination analysis at resume uses conservative pool-wide invalidation rather than DAG-based analysis (DAG-based analysis happens in T13 for the running protocol).

**Verification:** Write a test in `dag-executor.test.ts` that resumes a run with a stale `resolved_tools` and a `registryClient` mock that returns a newer destructive version. Confirm the pool candidates are invalidated.

---

## Task T15 — Add `getVersion()` method to `RegistryClient`

**File:** `packages/server/src/modules/registry/registry-client.ts`

**What:**
Check if `getVersion(toolName, version)` already exists. If not, add:

```typescript
async getVersion(toolName: string, version: number): Promise<ToolRecord | null> {
  await this.ensureInitialized();
  return this.db.findToolVersion(toolName, version);
}
```

Add `findToolVersion(toolName, version)` to `RegistryDb` in `storage/db.ts`:

```typescript
findToolVersion(name: string, version: number): ToolRecord | null {
  const row = this.raw().prepare(
    'SELECT * FROM tools WHERE name = ? AND version = ?'
  ).get(name, version) as ToolRow | undefined;
  if (!row) return null;
  return this.rowToRecord(row);
}
```

Also add `getLatest(toolName)` if it does not already exist:

```typescript
async getLatest(toolName: string): Promise<ToolRecord | null> {
  await this.ensureInitialized();
  return this.db.findLatestVersion(toolName);
}
```

```typescript
findLatestVersion(name: string): ToolRecord | null {
  const row = this.raw().prepare(
    'SELECT * FROM tools WHERE name = ? AND status = ? ORDER BY version DESC LIMIT 1'
  ).get(name, 'active') as ToolRow | undefined;
  if (!row) return null;
  return this.rowToRecord(row);
}
```

**Verification:** Check `registry-client.ts` for existing methods with these names before adding. If they exist under different names, map them in T14 / T09.

---

## Task T16 — Add new WebSocket event shapes to protocol

**File:** `packages/server/src/transport/protocol.ts`

**What:**
Read the file to understand the existing event union type. Add three new event types to the union:

```typescript
| { type: 'destructive_change_detected'; toolName: string; oldVersion: number; newVersion: number; affectedRunIds: string[] }
| { type: 'artifacts_invalidated'; runId: string; toolName: string; findingsCount: number; candidatesCount: number }
| { type: 'pin_updated'; runId: string; toolName: string; fromVersion: number; toVersion: number }
```

Also add `version_policy_applied` if there is a separate event for the action applied:

```typescript
| { type: 'version_policy_applied'; runId: string; action: string; toolName: string }
```

**Constraints:**
- Read the file before editing. The union type may be named differently (`ServerMessage`, `WsEvent`, etc.).
- Do not remove or rename existing events.

**Verification:** TypeScript compilation passes. No runtime test needed — the shapes are just type definitions.

---

## Task T17 — Emit WebSocket events in the destructive change handler

**File:** `packages/server/src/app.ts` (or `workflow/destructive-change-handler.ts`)

**What:**
In `handleDestructiveChange` (from T13), after each phase of the protocol, call the WebSocket broadcast function:

```typescript
// After identifying affected runs:
broadcast({ type: 'destructive_change_detected', toolName, oldVersion, newVersion, affectedRunIds });

// After invalidating artifacts for a run:
broadcast({ type: 'artifacts_invalidated', runId, toolName, findingsCount, candidatesCount });

// After updating pin:
broadcast({ type: 'pin_updated', runId, toolName, fromVersion: oldVersion, toVersion: newVersion });
```

Read `app.ts` to understand how the WebSocket broadcast is currently wired (likely via `websocket.ts`). The broadcast function signature must match what the transport layer provides.

**Constraints:**
- Events must be emitted even if some affected runs have `action: ignore` — emit `version_policy_applied` with `action: 'ignore'` for those runs.
- Do not throw if broadcast fails.

**Verification:** Manual test via WebSocket client or check existing WebSocket test infrastructure.

---

## Task T18 — Update `workflow_events` table comment/documentation

**File:** `packages/server/src/db/database.ts`

**What:**
The `workflow_events` table schema does not need structural changes (the existing columns `event` and `details` accommodate the new event types). However, add a comment near the schema definition listing the new event types for future maintainers:

```typescript
// New events added by Q1 version policy:
// - destructive_change_detected: node_name='__system__', details: JSON {toolName, oldVersion, newVersion}
// - artifacts_invalidated: node_name='__system__', details: JSON {toolName, findingsCount, candidatesCount, scope}
// - pin_updated: node_name='__system__', details: JSON {toolName, fromVersion, toVersion}
// - version_policy_applied: node_name='__system__', details: JSON {action, toolName}
```

This is a documentation-only change. No SQL migration required.

---

## Task T19 — Update seed tool `tool.yaml` files

**Files:** All `tool.yaml` files under `packages/server/src/modules/registry/seeds/`

**What:**
Each seed tool's `tool.yaml` must have `change_type: net_new` since they are all version 1. The migration adds the DB default, but the YAML files on disk must also declare it so re-registration from disk does not fail the parser.

```bash
grep -r "^change_type:" packages/server/src/modules/registry/seeds/
```

If none match, add `change_type: net_new` to every seed `tool.yaml`.

**How:** Read each file, confirm it is a version 1 tool, add `change_type: net_new` immediately after `version: 1`.

**Verification:** Run the seeds loader integration test: `packages/server/src/modules/registry/seeds/__tests__/loader.integration.test.ts`. All seed tools must register without errors.

---

## Task T20 — Update existing test fixtures

**What:**
Several tests construct raw YAML strings or `ToolManifest` objects. After T02–T03, they will fail because `change_type` is now required by the parser.

Files to check and update:
- `packages/server/src/modules/registry/manifest/__tests__/parser.test.ts` — all YAML fixture strings need `change_type: net_new` (version 1 tools)
- `packages/server/src/modules/registry/manifest/__tests__/validator.test.ts` — same
- `packages/server/src/modules/registry/__tests__/registry-client.test.ts` — same
- `packages/server/src/modules/registry/storage/__tests__/db.test.ts` — `ToolManifest` objects constructed directly need `change_type: 'net_new'`
- Integration tests in `packages/server/src/modules/registry/seeds/__tests__/categories/` — these use real YAML files updated in T19, so they pass automatically after T19

**Strategy:** Search for all places where a `ToolManifest` is constructed or a YAML string with `version: 1` is used, and add `change_type: 'net_new'` (or `change_type: net_new` in YAML).

**Verification:** Full test suite passes: `cd packages/server && npm test`. Zero test failures.

---

## Final verification checklist

After all 20 tasks are complete:

1. `npm run build` (TypeScript compilation) — zero errors.
2. `npm test` — all existing tests pass plus new tests added in each task.
3. Register a seed tool twice (v1 then v2 with `change_type: destructive`) in a test environment and confirm:
   - v2 registration succeeds.
   - `tool_invocations` table has a row for the v1 invocation.
   - `run-metadata.json` `resolved_tools` is updated to v2.
   - Pool candidates from the v1 run are `invalidated`.
   - WebSocket emits the three new event types.
4. Resume a workflow with a stale v1 pin in `resolved_tools` — confirm the resume check runs and the pool is updated.
5. Parse a workflow YAML with a valid `version_policy` block — confirm `WorkflowConfig.version_policy` is populated.
6. Parse a workflow YAML without `version_policy` — confirm `DEFAULT_VERSION_POLICY` is applied at all consumers.
