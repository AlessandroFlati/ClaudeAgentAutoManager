# Q1 Version Policy and Destructive Change Protocol — Implementation Spec

**Date:** 2026-04-13
**Resolves:** Q1 from `docs/design/remaining-topics.md` §2.1
**Status:** Ready for implementation
**Design refs:** `tool-registry.md` §8.2, §8.4 | `workflow-engine.md` §2.1, §8.3 | `evolutionary-pool.md` §2.1, §3.3 | `persistence.md` §4.1, §3.1, §5.1

---

## 1. Overview

This spec translates the Q1 patch documents into concrete code changes. Six subsystems are touched:

| Area | Files | Design ref |
|---|---|---|
| A — Tool Registry | `registry/types.ts`, `manifest/parser.ts`, `manifest/validator.ts`, `storage/db.ts` | §8.2, §8.4.3 |
| B — Workflow Engine | `workflow/types.ts`, `workflow/yaml-parser.ts`, `workflow/dag-executor.ts` | §2.1, §8.4.1, §8.4.5 |
| C — Destructive Protocol | `registry/registry-client.ts`, `db/database.ts` | §8.4.3–8.4.4 |
| D — Evolutionary Pool | `workflow/evolutionary-pool.ts` | §2.1, §3.3 |
| E — Resume Protocol | `workflow/dag-executor.ts` | §8.4.5 |
| F — Persistence | `db/database.ts`, run-metadata.json schema | §4.1, §3.1, §5.1 |

---

## 2. Area A — Tool Registry

### 2.1 `ChangeType` and `ToolManifest` (`registry/types.ts`)

Add `ChangeType` union type and extend `ToolManifest`:

```typescript
export type ChangeType = 'net_new' | 'additive' | 'destructive';

export interface ToolManifest {
  name: string;
  version: number;
  change_type: ChangeType;      // NEW — required for all tools
  // ... existing fields unchanged
}
```

The field is `change_type` (snake_case) in the YAML manifest and in `ToolManifest` to match the existing YAML convention used by the rest of the manifest (`entry_point`, `cost_class`, etc.). The parser already converts snake_case YAML keys to camelCase selectively — in this case keep the snake_case name on `ToolManifest` itself to avoid confusion, as the design doc uses it verbatim.

Also extend `ToolRecord` with `changeType`:

```typescript
export interface ToolRecord {
  // ... existing fields
  changeType: ChangeType;
}
```

### 2.2 Parse `change_type` (`manifest/parser.ts`)

In `parseToolManifest()`, after parsing `version`, read `change_type`:

```typescript
const VALID_CHANGE_TYPES = new Set(['net_new', 'additive', 'destructive']);

const rawChangeType = doc.change_type;
if (rawChangeType === undefined || rawChangeType === null) {
  throw new ManifestParseError('change_type is required', 'change_type');
}
if (typeof rawChangeType !== 'string' || !VALID_CHANGE_TYPES.has(rawChangeType)) {
  throw new ManifestParseError(
    `change_type must be one of net_new|additive|destructive (got "${rawChangeType}")`,
    'change_type',
  );
}
manifest.change_type = rawChangeType as ChangeType;
```

### 2.3 Validate `change_type` rules (`manifest/validator.ts`)

In `validateToolManifest()`, add two cross-field rules:

1. Version 1 must have `change_type: net_new`.
2. Versions >= 2 must have `change_type` of `additive` or `destructive` (never `net_new`).

```typescript
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

The validator is called after the parser, so `manifest.change_type` is always populated by this point.

### 2.4 SQL schema migration v2 → v3 (`storage/db.ts`)

Current `EXPECTED_SCHEMA_VERSION = 2`. Bump to 3. Add a migration in `applyMigrations`:

```typescript
const EXPECTED_SCHEMA_VERSION = 3;

// In applyMigrations(currentVersion):
if (currentVersion < 3) {
  db.exec(`
    ALTER TABLE tools ADD COLUMN change_type TEXT NOT NULL DEFAULT 'net_new';
    CREATE TABLE IF NOT EXISTS tool_invocations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp       TEXT    NOT NULL,
      tool_name       TEXT    NOT NULL,
      tool_version    INTEGER NOT NULL,
      run_id          TEXT,
      node_name       TEXT,
      scope           TEXT,
      duration_ms     INTEGER,
      success         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_inv_run      ON tool_invocations(run_id);
    CREATE INDEX IF NOT EXISTS idx_tool_inv_tool     ON tool_invocations(tool_name, tool_version);
  `);
}
```

Existing rows default to `net_new`, which is correct — the seed tools are all version 1.

Update `insertTool()` in `RegistryDb` to write `change_type` from `ToolManifest`. Update `rowToRecord()` to read it back into `ToolRecord.changeType`.

### 2.5 `ToolRecord` has `changeType` written from manifest

In `RegistryDb.insertTool()` (currently building the INSERT statement):

```typescript
stmt.run(
  manifest.name, manifest.version, manifest.change_type,
  // ... other fields
);
```

`rowToRecord()` reads: `changeType: row.change_type as ChangeType`.

---

## 3. Area B — Workflow Engine

### 3.1 `VersionPolicy` types (`workflow/types.ts`)

```typescript
export type VersionResolution = 'pin_at_start' | 'always_latest';
export type DestructiveChangeAction = 'invalidate_and_continue' | 'abort' | 'ignore';
export type InvalidationScope = 'contaminated' | 'all_findings' | 'all_candidates';

export interface VersionPolicy {
  resolution: VersionResolution;
  dynamic_tools: string[];          // glob patterns
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
  version_policy?: VersionPolicy;   // NEW — optional, defaults applied at runtime
  plugin?: string;
  _yamlPath?: string;
  config: Record<string, unknown> & { /* ... existing ... */ };
  shared_context: string;
  nodes: Record<string, WorkflowNodeDef>;
}
```

Also add `resolved_tools` to the in-memory config so `DagExecutor` can read it:

```typescript
/** Populated by DagExecutor.start() and updated by destructive change protocol. */
_resolved_tools?: Record<string, number>;
```

### 3.2 Parse `version_policy` (`workflow/yaml-parser.ts`)

In `parseWorkflow()`, after reading `name`, `version`, `config`, and `nodes`, optionally parse `version_policy`:

```typescript
if (raw.version_policy != null) {
  raw.version_policy = parseVersionPolicy(raw.version_policy, 'version_policy');
}
```

`parseVersionPolicy(raw, path)` validates the sub-fields:

- `resolution` must be `'pin_at_start'` or `'always_latest'` (default: `'pin_at_start'`)
- `dynamic_tools` must be an array of strings (default: `[]`)
- `on_destructive_change.action` must be one of three values (default: `'invalidate_and_continue'`)
- `on_destructive_change.scope` must be a string or array of valid values (default: `'contaminated'`)

Missing sub-fields receive their defaults. This function does NOT throw on unknown extra keys — it ignores them silently (forward-compat).

### 3.3 Version resolution at parse time (`workflow/dag-executor.ts`)

In `DagExecutor.start()`, after the type-checker call and before writing `run-metadata.json`, add a `resolveToolVersions()` step:

```typescript
private async resolveToolVersions(): Promise<Record<string, number>> {
  const policy = this.workflowConfig.version_policy ?? DEFAULT_VERSION_POLICY;
  if (!this.registryClient) return {};
  if (policy.resolution !== 'pin_at_start') return {};

  const resolved: Record<string, number> = {};
  const dynamicPatterns = policy.dynamic_tools;

  for (const [nodeName, nodeDef] of Object.entries(this.workflowConfig.nodes)) {
    if (nodeDef.kind !== 'tool' || !nodeDef.tool) continue;
    const toolName = nodeDef.tool;
    if (matchesAnyGlob(toolName, dynamicPatterns)) continue;   // skip dynamic
    const record = await this.registryClient.getLatest(toolName);
    if (!record) throw new Error(`Tool "${toolName}" not found in registry (node: ${nodeName})`);
    resolved[toolName] = record.version;
  }
  return resolved;
}
```

`matchesAnyGlob(toolName, patterns)` uses the `minimatch` package (already available via `yaml` dep chain, or add directly). Compares `toolName` against each glob pattern.

Write `resolved_tools` into `run-metadata.json` alongside the existing fields. Store it on `this.workflowConfig._resolved_tools` so `dispatchToolNode` can use it.

### 3.4 Dynamic tools at dispatch time (`DagExecutor.dispatchToolNode`)

When dispatching a `kind: tool` node, determine the tool version:

```typescript
private resolveToolVersion(toolName: string): number | undefined {
  const policy = this.workflowConfig.version_policy ?? DEFAULT_VERSION_POLICY;
  if (matchesAnyGlob(toolName, policy.dynamic_tools)) {
    return undefined;  // let registry resolve latest at invocation time
  }
  if (policy.resolution === 'pin_at_start') {
    const pinned = this.workflowConfig._resolved_tools?.[toolName];
    return pinned;   // undefined means tool was added after start — caller handles
  }
  return undefined;  // always_latest
}
```

Pass the resolved version into `InvocationRequest.version`.

---

## 4. Area C — Destructive Change Protocol

### 4.1 Protocol trigger in `RegistryClient.register()`

After a successful registration where `manifest.change_type === 'destructive'`, trigger the protocol:

```typescript
if (manifest.change_type === 'destructive') {
  await this.runDestructiveChangeProtocol(manifest.name, manifest.version - 1, manifest.version);
}
```

`runDestructiveChangeProtocol(toolName, oldVersion, newVersion)` is a private method on `RegistryClient`.

### 4.2 `runDestructiveChangeProtocol` (`registry-client.ts`)

```
runDestructiveChangeProtocol(toolName, oldVersion, newVersion):
  1. Identify affected runs:
     - Query plurics.db workflow_runs WHERE status IN ('running', 'interrupted')
     - For each run_id, query tool_invocations WHERE tool_name=toolName AND tool_version=oldVersion AND run_id=<run_id>
     - If no rows: run is not affected; skip.
  2. For each affected run:
     a. Load version_policy from workflow.yaml.snapshot in the run directory
     b. Apply policy.on_destructive_change.action:
        - 'abort': mark run as aborted_due_to_destructive_change, write abort-record.json, emit event, stop.
        - 'ignore': write warning to run log, emit event, stop.
        - 'invalidate_and_continue': proceed to step 3.
  3. Compute contaminated set (for scope=contaminated):
     - Load workflow DAG from workflow.yaml.snapshot
     - Find nodes that invoked toolName at oldVersion (from tool_invocations)
     - BFS/DFS downstream from those nodes in the DAG
     - Contaminated node set = source nodes + all downstream
  4. Invalidate:
     - For scope=contaminated: load pool-state.json, mark candidates produced by contaminated nodes as 'invalidated'
     - For scope=all_findings: mark all findings (future — tracked in pool metadata)
     - For scope=all_candidates: mark all candidates in pool
     - Write updated pool-state.json (atomic)
  5. Update resolved_tools in run-metadata.json:
     - Read run-metadata.json, update resolved_tools[toolName] = newVersion, write atomic
  6. Emit events to workflow_events table and WebSocket:
     - destructive_change_detected
     - artifacts_invalidated (with counts)
     - pin_updated (for each pinned tool updated)
```

### 4.3 `plurics.db` access from `RegistryClient`

`RegistryClient` currently has no reference to `plurics.db` (the workspace database). The protocol needs to query `workflow_runs`. Options:

- Pass a callback `onDestructiveChange` to `RegistryClient` at construction; `app.ts` wires it up.
- Or inject a `WorkflowRunScanner` interface.

**Chosen approach:** inject an optional `onDestructiveChange` callback:

```typescript
export interface DestructiveChangeEvent {
  toolName: string;
  oldVersion: number;
  newVersion: number;
}

export interface RegistryClientOptions {
  // ... existing
  onDestructiveChange?: (event: DestructiveChangeEvent) => Promise<void>;
}
```

`app.ts` provides the callback which queries `plurics.db` and applies the per-run policy. This keeps `RegistryClient` independent of the workspace DB.

### 4.4 WebSocket event shapes

Three new event types added to the WebSocket protocol (`transport/protocol.ts`):

```typescript
{ type: 'destructive_change_detected'; toolName: string; oldVersion: number; newVersion: number; affectedRunIds: string[] }
{ type: 'artifacts_invalidated'; runId: string; toolName: string; findingsCount: number; candidatesCount: number }
{ type: 'pin_updated'; runId: string; toolName: string; fromVersion: number; toVersion: number }
```

---

## 5. Area D — Evolutionary Pool

### 5.1 Add `invalidated` to `CandidateStatus` (`evolutionary-pool.ts`)

```typescript
export type CandidateStatus =
  | 'pending_evaluation'
  | 'active'
  | 'confirmed'
  | 'falsified'
  | 'pruned'
  | 'archived'
  | 'invalidated';   // NEW
```

### 5.2 `pool.invalidate(candidateId, reason)` method

```typescript
invalidate(id: string, reason: string): void {
  const existing = this.candidates.get(id);
  if (!existing) throw new Error(`Candidate not found: ${id}`);
  if (['pruned', 'archived', 'invalidated'].includes(existing.status)) return;  // idempotent
  this.candidates.set(id, {
    ...existing,
    status: 'invalidated',
    metadata: { ...existing.metadata, invalidation_reason: reason, invalidated_at: new Date().toISOString() },
    updatedAt: Date.now(),
  });
}
```

### 5.3 Exclude `invalidated` from `select()` and default `list()`

In `select()`, the default `statusFilter` currently includes `active`, `confirmed`, `pending_evaluation`. `invalidated` is already excluded because it is not in that default list — no change needed there.

In `list()` (when no explicit `status` filter is given), add `invalidated` to the implicit exclusion or document that callers must include it explicitly. Current behavior: `list()` without filters returns all candidates. Change: when no status filter is provided, exclude `invalidated`:

```typescript
list(filters?: PoolFilters): PoolCandidate[] {
  let candidates = [...this.candidates.values()];
  // Exclude invalidated by default unless explicitly requested
  if (!filters?.status) {
    candidates = candidates.filter(c => c.status !== 'invalidated');
  }
  // ... apply remaining filters
}
```

Preserve invalidated candidates in `restore()` / `snapshot()` — they must round-trip through serialization.

---

## 6. Area E — Resume Protocol

### 6.1 Destructive change check in `DagExecutor.resumeFrom()` (`dag-executor.ts`)

Insert after "Rebuild node graph from snapshot" and before "Demote orphaned nodes":

```typescript
// Step 4 (per design doc §8.4.5): check for destructive changes since snapshot
const metaPath = path.join(runDir, 'run-metadata.json');
const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
const resolvedTools: Record<string, number> = meta.resolved_tools ?? {};
if (this.registryClient && Object.keys(resolvedTools).length > 0) {
  await this.checkDestructiveChangesAtResume(resolvedTools, runDir);
}
```

`checkDestructiveChangesAtResume(resolvedTools, runDir)`:

```
For each (toolName, pinnedVersion) in resolvedTools:
  latestRecord = registryClient.getLatest(toolName)
  if latestRecord.version > pinnedVersion:
    for v = pinnedVersion+1 to latestRecord.version:
      record = registryClient.getVersion(toolName, v)
      if record.changeType === 'destructive':
        apply version_policy.on_destructive_change (loaded from workflow.yaml.snapshot)
        break  // applying once per tool is sufficient; protocol updates pin
```

This ensures a workflow resumed after multiple destructive changes processes them all.

---

## 7. Area F — Persistence

### 7.1 `run-metadata.json` schema

`resolved_tools` is written by `DagExecutor.start()` immediately after `resolveToolVersions()`:

```json
{
  "run_id": "run-1744...",
  "workflow_name": "math-discovery",
  "started_at": "2026-04-13T08:00:00Z",
  "completed_at": null,
  "status": "running",
  "config": { ... },
  "resolved_tools": {
    "pandas.load_parquet": 1,
    "stats.adf_test": 1,
    "sklearn.pca": 2
  },
  "summary": null,
  "artifacts": []
}
```

Tools in `version_policy.dynamic_tools` are NOT included. The `resolved_tools` map is mutated in-place by the destructive change protocol when `action: invalidate_and_continue` fires.

### 7.2 New event types in `workflow_events`

The existing `workflow_events` table has columns: `run_id`, `timestamp`, `node_name`, `from_state`, `to_state`, `event`, `details`.

New events use `node_name = '__system__'` (no specific node), `from_state = ''`, `to_state = ''`, and `details` (JSON string):

| `event` | `details` shape |
|---|---|
| `destructive_change_detected` | `{ toolName, oldVersion, newVersion, affectedNodeCount }` |
| `artifacts_invalidated` | `{ toolName, findingsCount, candidatesCount, scope }` |
| `pin_updated` | `{ toolName, fromVersion, toVersion }` |
| `version_policy_applied` | `{ action, toolName, reason }` |

### 7.3 `tool_invocations` table (`db.ts` — registry db migration)

Created in migration v2→v3 (see §2.4). Written by `RegistryClient` after every successful tool invocation when `callerContext` is provided:

```typescript
// In RegistryClient.invoke(), on success:
if (request.callerContext) {
  this.db.insertToolInvocation({
    toolName: request.toolName,
    toolVersion: resolvedVersion,
    runId: request.callerContext.workflowRunId,
    nodeName: request.callerContext.nodeName,
    scope: request.callerContext.scope,
    durationMs: result.metrics.durationMs,
    success: result.success,
  });
}
```

---

## 8. Seed tool migration

All existing seed tools are version 1. The migration adds `change_type = 'net_new'` as the column default, so existing rows are correctly labeled without any seed re-registration.

For new versions of seed tools registered during development, the tool author must declare `change_type: additive` or `change_type: destructive` in `tool.yaml`.

---

## 9. `minimatch` dependency

`matchesAnyGlob` uses `minimatch`. Check if it is already in `packages/server/package.json`; if not, add it. `minimatch` is a zero-dependency package widely used in the Node ecosystem.

---

## 10. Error handling principles

- Registration with invalid `change_type` fails with `manifest_validation` error — same path as all other manifest validation failures. No silent fallback.
- `resolveToolVersions()` throws if a required tool is not found in the registry. The workflow does not start.
- `checkDestructiveChangesAtResume()` throws if the new version of an affected tool cannot be retrieved (e.g., manually deleted). The resume fails; the run stays `interrupted`. Error message must be clear.
- `pool.invalidate()` is idempotent for already-invalidated candidates.
- Writing `run-metadata.json` during the destructive change protocol uses `writeJsonAtomic` to avoid partial writes.

---

## 11. Files changed

| File | Change |
|---|---|
| `packages/server/src/modules/registry/types.ts` | Add `ChangeType`, extend `ToolManifest`, `ToolRecord` |
| `packages/server/src/modules/registry/manifest/parser.ts` | Parse `change_type` |
| `packages/server/src/modules/registry/manifest/validator.ts` | Validate `change_type` rules |
| `packages/server/src/modules/registry/storage/db.ts` | Migration v3, `change_type` column, `tool_invocations` table |
| `packages/server/src/modules/registry/registry-client.ts` | Trigger protocol, log invocations, inject callback |
| `packages/server/src/modules/workflow/types.ts` | `VersionPolicy`, `DEFAULT_VERSION_POLICY`, `WorkflowConfig` |
| `packages/server/src/modules/workflow/yaml-parser.ts` | Parse `version_policy` |
| `packages/server/src/modules/workflow/dag-executor.ts` | `resolveToolVersions()`, resume check, version pin at dispatch |
| `packages/server/src/modules/workflow/evolutionary-pool.ts` | `invalidated` status, `invalidate()`, `list()` exclusion |
| `packages/server/src/db/database.ts` | New event types in `workflow_events` |
| `packages/server/src/transport/protocol.ts` | New WebSocket event shapes |
| `packages/server/src/app.ts` | Wire `onDestructiveChange` callback |
