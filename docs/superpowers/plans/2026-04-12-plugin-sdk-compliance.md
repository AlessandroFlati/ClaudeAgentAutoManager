# Plugin SDK Compliance Refactor — Implementation Plan

**Date:** 2026-04-12
**Spec:** `docs/superpowers/specs/2026-04-12-plugin-sdk-compliance-design.md`
**Branch:** `feat/plugin-sdk-compliance`
**Estimated total:** ~9 days

---

## Task Index

| # | Title | Phase | Est |
|---|---|---|---|
| T01 | Add `PlatformServices` + `PlatformLogger` to `sdk.ts` | A | 2h |
| T02 | Add all context and result types to `sdk.ts` | A | 3h |
| T03 | Update `WorkflowPlugin` interface in `sdk.ts`, delete old types | A | 1h |
| T04 | Add `EvolutionaryPool.snapshot()` method | A | 1h |
| T05 | Refactor `onWorkflowStart` invocation in `dag-executor.ts` | A | 1h |
| T06 | Refactor `onWorkflowResume` invocation in `dag-executor.ts` | A | 1h |
| T07 | Refactor `onWorkflowComplete` invocation in `dag-executor.ts` | A | 1h |
| T08 | Refactor `onSignalReceived` invocation + action dispatch | A | 3h |
| T09 | Refactor `onEvaluationResult` invocation | A | 1h |
| T10 | Refactor `onEvaluateReadiness` invocation (sync → async) | A | 2h |
| T11 | Refactor `onResolveRouting` invocation | A | 1h |
| T12 | Refactor `onPurposeGenerate` invocation + enrichment application | A | 2h |
| T13 | Add `onEvolutionaryContext` invocation in `buildPurpose` | A | 2h |
| T14 | Implement per-hook error handling per §9 table | C | 3h |
| T15 | Migrate `research-swarm/plugin.ts` | A | 3h |
| T16 | Migrate `theorem-prover-mini/plugin.ts` | A | 3h |
| T17 | Migrate `math-discovery/plugin.ts` | A | 2h |
| T18 | Migrate `sequence-explorer/plugin.ts` | A | 1h |
| T19 | Migrate `smoke-test/plugin.ts` | A | 1h |
| T20 | Implement `declareTools` hook and invocation | B | 1d |
| T21 | Implement `onToolProposal` hook and invocation | B | 3d |
| T22 | Add `onToolRegression` stub invocation point | B | 0.5d |
| T23 | Unit tests: types, context construction, PlatformServices | C | 3h |
| T24 | Unit tests: hook invocation logic (per hook) | C | 4h |
| T25 | Unit tests: error handling paths | C | 2h |
| T26 | Unit tests: TR Phase 6 hooks | C | 2h |
| T27 | TypeScript build clean + integration smoke test | C | 1h |

---

## Phase A — Refactor existing hooks

### T01 — Add `PlatformServices` + `PlatformLogger` to `sdk.ts`

**File:** `packages/server/src/modules/workflow/sdk.ts`

**What:**
Add at the top of the file, before the `WorkflowPlugin` interface:

```typescript
export interface PlatformLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface PlatformServices {
  registryClient: import('../registry/index.js').RegistryClient | null;
  valueStore: import('../registry/execution/value-store.js').ValueStore | null;
  logger: PlatformLogger;
  runDirectory: string;
}
```

**Also add** to `dag-executor.ts`:

```typescript
private buildPlatformServices(): PlatformServices {
  const runDir = path.join(this.workspacePath, '.plurics', 'runs', this.runId);
  const logPath = path.join(runDir, 'plugin-log.jsonl');
  const writeLog = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }) + '\n';
    fs.appendFile(logPath, entry).catch(() => {});
    if (level === 'error') console.error(`[plugin] ${msg}`, meta ?? '');
    else if (level === 'warn') console.warn(`[plugin] ${msg}`, meta ?? '');
    else console.log(`[plugin] ${msg}`, meta ?? '');
  };
  return {
    registryClient: this.registryClient,
    valueStore: this.valueStore,
    logger: {
      info: (msg, meta) => writeLog('info', msg, meta),
      warn: (msg, meta) => writeLog('warn', msg, meta),
      error: (msg, meta) => writeLog('error', msg, meta),
    },
    runDirectory: runDir,
  };
}
```

**Verification:** `tsc --noEmit` passes.

---

### T02 — Add all context and result types to `sdk.ts`

**File:** `packages/server/src/modules/workflow/sdk.ts`

**What:** Add all types from Spec §4 (context + result types). Full list:

- `WorkflowStartContext`
- `WorkflowResumeContext`
- `WorkflowCompleteContext`
- `Finding`
- `SignalContext`
- `SignalDecision`
- `HandoffFile`
- `EvaluationContext`
- `ReadinessContext`
- `ReadinessDecision`
- `RoutingContext`
- `RoutingDecision`
- `PurposeContext` (new rich version, replacing old flat one)
- `PurposeEnrichment`
- `EvolutionaryContextRequest`
- `EvolutionaryContextResult`
- `ToolDeclaration`
- `ToolProposalContext`
- `ToolProposalResult`
- `ToolRegressionContext`
- `ToolRegressionResult`

**Implementation notes:**
- `PoolSnapshot` is `ReturnType<EvolutionaryPool['snapshot']>` — import the type from `./evolutionary-pool.js`.
- `ToolManifest` — search for exported type in `packages/server/src/modules/registry/`. If not exported, use `Record<string, unknown>` with a `// TODO: replace with ToolManifest` comment.
- `WorkflowCompleteContext.status` `'aborted'` maps to the current abort path (nodes skipped).
- `WorkflowCompleteContext.finalFindings` will be `[]` in MVP; the findings callback accumulates them but they aren't aggregated yet — return empty array initially.

**Verification:** No imports broken in existing plugins (they will break temporarily; fixed in T15–T19).

---

### T03 — Update `WorkflowPlugin` interface, delete old types

**File:** `packages/server/src/modules/workflow/sdk.ts`

**What:**
Replace the existing `WorkflowPlugin` interface with the design-doc version (Spec §5).

Delete these types (no longer exported):
- `SignalOverride`
- `RoutingResult`
- `PurposeContext` (old flat version — replaced by new one)
- `EvolutionaryContext` (old — replaced by `EvolutionaryContextResult`)
- `DagNodeState`
- `WorkflowSummary` (move to `dag-executor.ts` as an internal type; it was already re-declared there)

**Verification:** All 5 plugin files will fail to compile until T15–T19; that is expected. `dag-executor.ts` will fail until T05–T13.

---

### T04 — Add `EvolutionaryPool.snapshot()` method

**File:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**What:** Read the file first. Add:

```typescript
snapshot(): { candidates: ReadonlyArray<PoolCandidate>; round: number } {
  return {
    candidates: [...this.candidates.values()],
    round: this.currentRound,
  };
}
```

Adjust field names to match actual `EvolutionaryPool` internals after reading the file.

**Verification:** TypeScript picks up the return type for `PoolSnapshot`.

---

### T05 — Refactor `onWorkflowStart` in `dag-executor.ts`

**File:** `packages/server/src/modules/workflow/dag-executor.ts`

**Locate:** Line ~174: `await this.plugin?.onWorkflowStart?.(this.workspacePath, this.workflowConfig.config);`

**Replace with:**
```typescript
if (this.plugin?.onWorkflowStart) {
  const ctx: WorkflowStartContext = {
    runId: this.runId,
    workflowName: this.workflowConfig.name,
    workflowVersion: this.workflowConfig.version ?? '0.0.0',
    workflowConfig: this.workflowConfig.config,
    runDirectory: path.join(this.workspacePath, '.plurics', 'runs', this.runId),
    platform: this.buildPlatformServices(),
  };
  try {
    await this.plugin.onWorkflowStart(ctx);
  } catch (err) {
    throw new Error(`[plugin] onWorkflowStart failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

**Note:** `this.workflowConfig.name` and `.version` — check the `WorkflowConfig` type to confirm field names; fall back to `this.workflowConfig.workflow ?? 'unknown'` if `name` is not present.

---

### T06 — Refactor `onWorkflowResume` in `dag-executor.ts`

**Locate:** Lines ~305–310.

**Replace with:**
```typescript
if (this.plugin?.onWorkflowResume) {
  const resumeCtx: WorkflowResumeContext = {
    runId: this.runId,
    workflowName: this.workflowConfig.name ?? this.workflowConfig.workflow ?? 'unknown',
    workflowVersion: this.workflowConfig.version ?? '0.0.0',
    workflowConfig: this.workflowConfig.config,
    runDirectory: path.join(this.workspacePath, '.plurics', 'runs', this.runId),
    platform: this.buildPlatformServices(),
    snapshotTimestamp: new Date().toISOString(), // read from snapshot metadata if available
    pendingNodes: [...this.nodes.values()]
      .filter(n => n.state === 'pending').map(n => n.name),
    completedNodes: completedNodes.map(n => n.name),
  };
  try {
    await this.plugin.onWorkflowResume(resumeCtx);
  } catch (err) {
    throw new Error(`[plugin] onWorkflowResume failed: ${err instanceof Error ? err.message : String(err)}`);
  }
} else if (this.plugin?.onWorkflowStart) {
  // Fallback as before
  const ctx: WorkflowStartContext = { /* same as T05 */ };
  await this.plugin.onWorkflowStart(ctx);
}
```

**Note:** The snapshot timestamp is in `run-metadata.json` under `started_at`; read it if available.

---

### T07 — Refactor `onWorkflowComplete` in `dag-executor.ts`

**Locate:** Lines ~1176–1183 in `emitWorkflowComplete`.

**Replace with:**
```typescript
if (this.plugin?.onWorkflowComplete) {
  const status = summary.failed > 0 ? 'failure' : 'success';
  const completeCtx: WorkflowCompleteContext = {
    runId: this.runId,
    workflowName: this.workflowConfig.name ?? this.workflowConfig.workflow ?? 'unknown',
    workflowVersion: this.workflowConfig.version ?? '0.0.0',
    workflowConfig: this.workflowConfig.config,
    runDirectory: path.join(this.workspacePath, '.plurics', 'runs', this.runId),
    platform: this.buildPlatformServices(),
    status,
    duration_seconds: summary.duration_seconds,
    nodesCompleted: summary.completed,
    nodesFailed: summary.failed,
    finalFindings: [],  // TODO: populate from FindingCallback accumulator in future
  };
  try {
    await this.plugin.onWorkflowComplete(completeCtx);
  } catch (err) {
    // Error handling per §9: log but do not affect workflow status
    const ps = this.buildPlatformServices();
    ps.logger.error('onWorkflowComplete hook threw', { error: String(err) });
  }
}
```

---

### T08 — Refactor `onSignalReceived` + action dispatch

**Locate:** Lines ~778–784.

**Current code reads `signal` from node, calls plugin, gets `SignalOverride | null`, mutates `signal` in-place.**

**Replace with:**
```typescript
if (this.plugin?.onSignalReceived) {
  const upstreamHandoffs = this.buildUpstreamHandoffs(node);
  const signalCtx: SignalContext = {
    runId: this.runId,
    signal,
    nodeName: node.name,
    scope: node.scope,
    upstreamHandoffs,
    platform: this.buildPlatformServices(),
  };
  let decision: SignalDecision;
  try {
    decision = await this.plugin.onSignalReceived(signalCtx);
  } catch (err) {
    this.transition(node.name, 'failed');
    node.signal = { ...signal, status: 'failure', error: { message: `plugin_signal_error: ${err}`, recoverable: false } };
    return;
  }
  switch (decision.action) {
    case 'accept':
      break;
    case 'accept_with_handoff':
      await this.writeHandoffs(decision.handoffs ?? [], node);
      break;
    case 'reject_and_retry':
      node.retryCount++;
      this.transition(node.name, 'retrying');
      await this.scheduleNode(node, decision.retryReason);
      return;
    case 'reject_and_branch':
      if (decision.branch) {
        await this.handleExplicitBranch(node, decision.branch.target, decision.branch.state);
      }
      return;
  }
}
```

**Add private helper:**
```typescript
private buildUpstreamHandoffs(node: DagNode): Record<string, unknown> {
  const handoffs: Record<string, unknown> = {};
  for (const dep of node.deps ?? []) {
    const depNode = this.nodes.get(dep);
    if (depNode?.signal?.outputs) {
      handoffs[dep] = depNode.signal.outputs;
    }
  }
  return handoffs;
}

private async writeHandoffs(handoffs: HandoffFile[], node: DagNode): Promise<void> {
  const runDir = path.join(this.workspacePath, '.plurics', 'runs', this.runId);
  for (const hf of handoffs) {
    const target = path.join(runDir, hf.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, hf.content, 'utf-8');
  }
}
```

---

### T09 — Refactor `onEvaluationResult`

**Locate:** Lines ~786–791.

**Replace with:**
```typescript
if (this.plugin?.onEvaluationResult) {
  const evalCtx: EvaluationContext = {
    runId: this.runId,
    evaluatorNode: node.name,
    scope: node.scope,
    candidateId: signal.outputs?.candidate_id as string ?? node.name,
    fitness: signal.outputs?.fitness as number ?? 0,
    verdict: (signal.outputs?.verdict as EvaluationContext['verdict']) ?? 'inconclusive',
    evidence: (signal.outputs ?? {}) as Record<string, unknown>,
    platform: this.buildPlatformServices(),
  };
  try {
    await this.plugin.onEvaluationResult(evalCtx);
  } catch (err) {
    const ps = this.buildPlatformServices();
    ps.logger.error('onEvaluationResult hook threw', { error: String(err), node: node.name });
    // swallow — pool may be inconsistent; workflow continues
  }
}
```

Note: Direct `pool` parameter is removed. Plugins that need pool access hold a private reference. The 3 plugins that use `onEvaluationResult` will be updated in T15–T17.

---

### T10 — Refactor `onEvaluateReadiness` (sync → async)

**Locate:** Lines ~476–483.

**Current code is sync:**
```typescript
const pluginResult = this.plugin.onEvaluateReadiness(name, nodeStates);
if (pluginResult === true) { ... }
if (pluginResult === false) continue;
```

**Replace with:**
```typescript
if (this.plugin?.onEvaluateReadiness) {
  const readyCtx: ReadinessContext = {
    runId: this.runId,
    nodeName: name,
    scope: node.scope,
    dependenciesCompleted: (node.deps ?? []).filter(d => {
      const dn = this.nodes.get(d);
      return dn?.state === 'completed';
    }),
    platform: this.buildPlatformServices(),
  };
  let decision: ReadinessDecision;
  try {
    decision = await this.plugin.onEvaluateReadiness(readyCtx);
  } catch (err) {
    // Per §9: node stays pending; re-evaluated on next state change
    const ps = this.buildPlatformServices();
    ps.logger.warn('onEvaluateReadiness hook threw; node stays pending', { error: String(err), node: name });
    continue;
  }
  if (decision.ready) {
    this.transition(name, 'deps_met');
    continue;
  } else {
    // Node stays pending; optionally schedule re-evaluation
    if (decision.retryAfter) {
      setTimeout(() => this.evaluateReadyNodes(), decision.retryAfter * 1000);
    }
    continue;
  }
}
```

**Note:** `evaluateReadyNodes` must be made `async` (or converted to use `void` scheduling). Check if the calling sites handle a returned promise. The function is called in several places — verify each.

---

### T11 — Refactor `onResolveRouting`

**Locate:** Lines ~838–844.

**Replace with:**
```typescript
if (this.plugin?.onResolveRouting && node.signal) {
  const candidateBranches = nodeDef.branch.map((b: { goto: string }) => b.goto);
  const routingCtx: RoutingContext = {
    runId: this.runId,
    sourceNode: node.name,
    scope: node.scope,
    decision: node.signal.decision,
    candidateBranches,
    platform: this.buildPlatformServices(),
  };
  let routingDecision: RoutingDecision | null = null;
  try {
    routingDecision = await this.plugin.onResolveRouting(routingCtx);
  } catch (err) {
    this.transition(node.name, 'failed');
    node.signal.status = 'failure';
    node.signal.error = { message: `plugin_routing_error: ${err}`, recoverable: false };
    return;
  }
  if (routingDecision) {
    await this.handleBranchDecisionByTarget(node, routingDecision.selectedBranch, routingDecision.state);
    resolved = true;
  }
}
```

---

### T12 — Refactor `onPurposeGenerate` + enrichment application

**Locate:** Lines ~651–660.

**Replace with:**
```typescript
if (this.plugin?.onPurposeGenerate) {
  const upstreamHandoffs = this.buildUpstreamHandoffs(node);
  const purposeCtx: PurposeContext = {
    runId: this.runId,
    nodeName: node.name,
    scope: node.scope,
    basePreset: purpose,
    upstreamHandoffs,
    attemptNumber: node.retryCount + 1,
    platform: this.buildPlatformServices(),
  };
  let enrichment: PurposeEnrichment;
  try {
    enrichment = await this.plugin.onPurposeGenerate(purposeCtx);
  } catch (err) {
    this.transition(node.name, 'failed');
    throw new Error(`plugin_purpose_error: ${err}`);
  }
  if (enrichment.replace) {
    purpose = enrichment.replace;
  } else {
    if (enrichment.prepend) purpose = enrichment.prepend + '\n' + purpose;
    if (enrichment.append) purpose = purpose + '\n' + enrichment.append;
    if (enrichment.variables) purpose = applyVariables(purpose, enrichment.variables);
  }
}
```

**Add helper:**
```typescript
function applyVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
```

---

### T13 — Add `onEvolutionaryContext` invocation

**Location:** In `buildPurpose` (or equivalent method), before `onPurposeGenerate`.

**What:** Check `workflowConfig.nodes[node.name]?.evolutionary_role`. If present and `plugin.onEvolutionaryContext` is defined:

```typescript
if (nodeDef?.evolutionary_role && this.plugin?.onEvolutionaryContext) {
  const evoCtx: EvolutionaryContextRequest = {
    runId: this.runId,
    nodeName: node.name,
    role: nodeDef.evolutionary_role as 'generator' | 'evaluator' | 'selector',
    scope: node.scope,
    poolSnapshot: this.pool.snapshot(),
    platform: this.buildPlatformServices(),
  };
  let evoResult: EvolutionaryContextResult;
  try {
    evoResult = await this.plugin.onEvolutionaryContext(evoCtx);
  } catch (err) {
    this.transition(node.name, 'failed');
    throw new Error(`plugin_purpose_error (evolutionary): ${err}`);
  }
  upstreamHandoffs.__evolutionary = evoResult;
}
```

This means `buildUpstreamHandoffs` must be called before this block so `upstreamHandoffs` is available. Adjust ordering accordingly.

---

### T14 — Per-hook error handling

**File:** `packages/server/src/modules/workflow/dag-executor.ts`

This is partially done inline in T05–T13. This task is a review pass to ensure every hook call site has the correct try/catch behavior from the §9 table:

- `declareTools`, `onWorkflowStart`, `onWorkflowResume`: throw (fail workflow start/resume).
- `onWorkflowComplete`: log + swallow.
- `onSignalReceived`, `onResolveRouting`: transition node to `failed`.
- `onPurposeGenerate`, `onEvolutionaryContext`: transition node to `failed` (no static preset fallback).
- `onEvaluationResult`: log + swallow.
- `onEvaluateReadiness`: node stays pending.
- `onToolProposal`: node failure signal with error as rejection reason.
- `onToolRegression`: rollback new tool (in stub: log only).

Create a helper:
```typescript
private nodePluginFail(node: DagNode, hookName: string, err: unknown): void {
  const message = `${hookName}_error: ${err instanceof Error ? err.message : String(err)}`;
  this.transition(node.name, 'failed');
  if (!node.signal) node.signal = {} as SignalFile;
  node.signal.status = 'failure';
  node.signal.error = { message, recoverable: false };
}
```

---

## Phase A — Plugin Migrations (T15–T19)

These are mechanical. Each plugin is read first, then each hook is migrated using the pattern from Spec §9. The steps are identical in structure; abbreviated below.

---

### T15 — Migrate `research-swarm/plugin.ts`

**File:** `workflows/research-swarm/plugin.ts`

**Hooks present:** `onWorkflowStart`, `onWorkflowResume`, `onSignalReceived`, `onPurposeGenerate`, `onEvaluateReadiness`, `onResolveRouting`, `onWorkflowComplete`

**Steps:**
1. Read file.
2. Replace import of old SDK types with new ones.
3. `onWorkflowStart(workspacePath, config)` → `onWorkflowStart(ctx: WorkflowStartContext)`: replace `workspacePath` refs with `ctx.platform.runDirectory` or `ctx.runDirectory`; replace `config` with `ctx.workflowConfig`.
4. `onWorkflowResume(workspacePath, config, completedNodes)` → `onWorkflowResume(ctx: WorkflowResumeContext)`: `completedNodes` was `Array<{name, scope, signal}>` — now read from `ctx.completedNodes` (string[]). If signal data needed, read from `ctx.platform.runDirectory/<node>.done.json`.
5. `onSignalReceived(nodeName, signal, workspacePath)` → `onSignalReceived(ctx: SignalContext)`: replace params. Map old `SignalOverride` returns to `SignalDecision`: `{ status: 'branch', decision: { goto: X } }` → `{ action: 'reject_and_branch', branch: { target: X, state: {} } }` or `{ action: 'accept' }`. Cases where override was `null` → `{ action: 'accept' }`.
6. `onPurposeGenerate(nodeName, base, oldCtx)` → `onPurposeGenerate(ctx: PurposeContext)`: wrap return string in `{ append: returnedString }` unless plugin was replacing the whole purpose (then use `replace`). Map `oldCtx.scope/retryCount/workspacePath` → `ctx.scope/attemptNumber/platform.runDirectory`.
7. `onEvaluateReadiness(nodeName, allNodes)` → `onEvaluateReadiness(ctx: ReadinessContext)`: make async, return `ReadinessDecision`.
8. `onResolveRouting(nodeName, signal, branchRules, workspacePath)` → `onResolveRouting(ctx: RoutingContext)`: map `branchRules[].goto` strings to `ctx.candidateBranches`, return `RoutingDecision`.
9. `onWorkflowComplete(workspacePath, summary)` → `onWorkflowComplete(ctx: WorkflowCompleteContext)`.
10. `tsc --noEmit` for this plugin.

---

### T16 — Migrate `theorem-prover-mini/plugin.ts`

**File:** `workflows/theorem-prover-mini/plugin.ts`

**Hooks present:** `onWorkflowStart`, `onWorkflowResume`, `onSignalReceived`, `onEvaluationResult`, `onPurposeGenerate`, `onEvolutionaryContext`, `onWorkflowComplete`

**Note:** `onEvaluationResult` previously received `pool` directly. The plugin now uses its own internal pool reference (it already holds a `EvolutionaryPool` as a private field — confirm on read). `onEvolutionaryContext` previously returned the old `EvolutionaryContext` type; now returns `EvolutionaryContextResult` (rename fields: `confirmedFindings` → `ancestors`, add `customContext: {}`).

Follow same 10-step pattern as T15.

---

### T17 — Migrate `math-discovery/plugin.ts`

**File:** `workflows/math-discovery/plugin.ts`

**Hooks present:** Read file to confirm. Expected: `onWorkflowStart`, `onSignalReceived`, `onEvaluationResult`, `onPurposeGenerate`, `onEvolutionaryContext`.

Follow same pattern. `onEvolutionaryContext` same rename as T16.

---

### T18 — Migrate `sequence-explorer/plugin.ts`

**File:** `workflows/sequence-explorer/plugin.ts`

**Hooks present:** Read file to confirm. Expected: `onWorkflowStart`, `onSignalReceived`, `onPurposeGenerate`.

Straightforward. Follow same pattern. Est: 1h.

---

### T19 — Migrate `smoke-test/plugin.ts`

**File:** `workflows/smoke-test/plugin.ts`

**Hooks present:** Read file to confirm. Expected: minimal — `onWorkflowStart`, maybe `onSignalReceived`.

Straightforward. Est: 30min.

---

## Phase B — TR Phase 6 Hooks

### T20 — Implement `declareTools`

**Files:**
- `packages/server/src/modules/workflow/sdk.ts` — `ToolDeclaration` already added in T02.
- `packages/server/src/modules/workflow/dag-executor.ts` — add invocation.
- `packages/server/src/modules/registry/index.ts` or equivalent — add `lookup(name, version)` if not present.

**Invocation location:** `DagExecutor.start()`, after plugin load, before `onWorkflowStart`:

```typescript
if (this.plugin?.declareTools) {
  const startCtx = this.buildStartContext();
  let declarations: ToolDeclaration[];
  try {
    declarations = await this.plugin.declareTools(startCtx);
  } catch (err) {
    throw new Error(`[plugin] declareTools failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await this.validateToolDeclarations(declarations);
}
```

**`validateToolDeclarations` implementation:**

```typescript
private async validateToolDeclarations(declarations: ToolDeclaration[]): Promise<void> {
  if (!this.registryClient) {
    const ps = this.buildPlatformServices();
    ps.logger.warn('declareTools: registry not available, skipping validation');
    return;
  }
  for (const decl of declarations) {
    try {
      const found = await this.registryClient.lookup(decl.name);
      if (!found) {
        if (decl.required) {
          throw new Error(`Required tool '${decl.name}' not found in registry. ${decl.reason ?? ''}`);
        } else {
          const ps = this.buildPlatformServices();
          ps.logger.warn(`Optional tool '${decl.name}' not found`, { reason: decl.reason });
        }
      } else if (decl.version !== 'latest' && found.version !== decl.version) {
        const msg = `Tool '${decl.name}' version mismatch: requested ${decl.version}, found ${found.version}`;
        if (decl.required) {
          throw new Error(msg);
        } else {
          const ps = this.buildPlatformServices();
          ps.logger.warn(msg);
        }
      }
    } catch (err) {
      if (decl.required) throw err;
    }
  }
}
```

**`RegistryClient.lookup` interface:** Check if `lookup(name: string): Promise<{ version: number } | null>` is already on the interface. If not, add it to the `RegistryClient` interface (do not implement; only add the signature — this task does not implement a new registry method, it just adds the type contract; the method may already exist under a different name).

**Verification:** `tsc --noEmit`. Manual test: create a test workflow config with a `declareTools` that returns a known tool name; verify no error.

---

### T21 — Implement `onToolProposal`

**Files:**
- `packages/server/src/modules/workflow/dag-executor.ts`
- `packages/server/src/modules/registry/index.ts` (read `register` signature)

**This is the most complex task. Read the following before starting:**
- `packages/server/src/modules/workflow/dag-executor.ts` signal handling section (~line 775)
- `packages/server/src/modules/registry/index.ts` or `registry-client.ts` for `register` method signature
- `docs/design/tool-registry.md` for `caller: 'agent'` registration flow

**Step 1: Signal detection.**

After the existing `onSignalReceived` block, add:

```typescript
// TR Phase 6: tool proposal detection
if (signal.outputs?.tool_proposal && typeof signal.outputs.tool_proposal === 'object') {
  await this.handleToolProposal(node, signal, signal.outputs.tool_proposal as RawToolProposal);
  return; // proposal handling is terminal for this signal cycle
}
```

**Step 2: Define `RawToolProposal`** (local type to `dag-executor.ts`):

```typescript
interface RawToolProposal {
  name: string;
  description: string;
  manifest: Record<string, unknown>;
  implementation_source: string;
  tests_source: string;
  rationale: string;
}
```

**Step 3: Implement `handleToolProposal`:**

```typescript
private async handleToolProposal(node: DagNode, signal: SignalFile, raw: RawToolProposal): Promise<void> {
  if (!this.plugin?.onToolProposal) {
    this.nodePluginFail(node, 'tool_proposal_rejected', new Error('workflow does not accept tool proposals'));
    return;
  }
  if (!this.registryClient) {
    this.nodePluginFail(node, 'tool_proposal_rejected', new Error('registry not available'));
    return;
  }

  const proposal: ToolProposalContext['proposal'] = {
    name: raw.name,
    description: raw.description,
    manifest: raw.manifest as ToolManifest,
    implementationSource: raw.implementation_source,
    testsSource: raw.tests_source,
    rationale: raw.rationale,
  };

  const ctx: ToolProposalContext = {
    runId: this.runId,
    proposingNode: node.name,
    scope: node.scope,
    proposal,
    platform: this.buildPlatformServices(),
  };

  let result: ToolProposalResult;
  try {
    result = await this.plugin.onToolProposal(ctx);
  } catch (err) {
    this.nodePluginFail(node, 'plugin_tool_proposal_error', err);
    return;
  }

  if (result.decision === 'reject') {
    this.nodePluginFail(node, 'tool_proposal_rejected', new Error(result.rejectionReason ?? 'rejected by plugin'));
    return;
  }

  // Apply modifications if 'modify'
  const finalProposal = result.decision === 'modify' && result.modifications
    ? this.applyProposalModifications(proposal, result.modifications)
    : proposal;

  // Route through registry
  try {
    const registered = await this.registryClient.register(
      { ...finalProposal.manifest, name: finalProposal.name } as ToolManifest,
      finalProposal.implementationSource,
      finalProposal.testsSource,
      { caller: 'agent', runId: this.runId, nodeId: node.name },
    );
    result.registeredVersion = registered.version;
    const ps = this.buildPlatformServices();
    ps.logger.info('Tool registered via proposal', { name: finalProposal.name, version: registered.version });
    // Node completes normally with registration info in outputs
    signal.outputs = { ...(signal.outputs ?? {}), registered_tool: { name: finalProposal.name, version: registered.version } };
  } catch (err) {
    this.nodePluginFail(node, 'tool_registration_failed', err);
    return;
  }
}

private applyProposalModifications(
  proposal: ToolProposalContext['proposal'],
  mods: NonNullable<ToolProposalResult['modifications']>,
): ToolProposalContext['proposal'] {
  return {
    ...proposal,
    manifest: mods.manifest ? { ...proposal.manifest, ...mods.manifest } as ToolManifest : proposal.manifest,
    implementationSource: mods.implementationSource ?? proposal.implementationSource,
    testsSource: mods.testsSource ?? proposal.testsSource,
  };
}
```

**Step 4: Verify `registryClient.register` signature.** Read `packages/server/src/modules/registry/index.ts`. The `register` method may have a different signature than assumed above. Adjust parameter shape to match. If `caller: 'agent'` mode is not yet supported, add it as an optional field with a TODO comment.

**Step 5: Agent test runner note.** The design doc mentions "agent test runner currently stubbed as not implemented". The `registryClient.register` call will either run tests internally (if the registry already runs tests on registration) or stub it. Do not implement the test runner in this task — rely on whatever `registryClient.register` already does, and add a `// TODO TR Phase 6: agent test runner` comment.

**Verification:**
- `tsc --noEmit`.
- Manual test: modify `smoke-test/plugin.ts` to implement `onToolProposal` returning `{ decision: 'accept' }`. Emit a signal from smoke-test with `outputs.tool_proposal`. Verify the hook is called (via logger output).

---

### T22 — Add `onToolRegression` stub invocation point

**File:** `packages/server/src/modules/workflow/dag-executor.ts`

**What:** Add a comment block and a dead-code stub inside `validateToolDeclarations` (or a separate private method `handleToolRegression`) that will be activated when the regression testing engine is added:

```typescript
/**
 * onToolRegression invocation point.
 * Called when regression testing is enabled and a new tool causes a test failure
 * in a related existing tool. The regression testing engine is deferred post-MVP.
 * When implemented, call this.invokeToolRegressionHook(ctx) here.
 */
// private async invokeToolRegressionHook(ctx: ToolRegressionContext): Promise<void> {
//   if (!this.plugin?.onToolRegression) {
//     // Default: rollback
//     return;
//   }
//   const result = await this.plugin.onToolRegression(ctx);
//   // act on result.action
// }
```

Also add to `dag-executor.ts` at the registration point in `handleToolProposal`, after successful registration:

```typescript
// TODO TR Phase 6 regression: if registryClient emits regression event, call invokeToolRegressionHook
```

**Verification:** No functional change; just TypeScript compiles.

---

## Phase C — Error Handling and Tests

### T23 — Unit tests: types, context construction, PlatformServices

**File:** `packages/server/src/modules/workflow/__tests__/plugin-sdk-types.test.ts` (create)

**Tests:**
1. `buildPlatformServices()` returns object with `registryClient: null` when registry not provided.
2. `buildPlatformServices()` returns object with correct `runDirectory` path.
3. `PlatformLogger.info/warn/error` call appends to `plugin-log.jsonl` (mock `fs.appendFile`).
4. `buildUpstreamHandoffs` correctly extracts `outputs` from completed upstream nodes.
5. `WorkflowStartContext` fields are populated correctly from `WorkflowConfig`.
6. `WorkflowResumeContext` includes correct `pendingNodes` and `completedNodes`.
7. `WorkflowCompleteContext.status` is `'failure'` when `nodesFailed > 0`.

---

### T24 — Unit tests: hook invocation logic

**File:** `packages/server/src/modules/workflow/__tests__/dag-executor-hooks.test.ts` (create or extend existing)

**Tests (one describe block per hook):**

**`onSignalReceived`:**
1. Returns `{ action: 'accept' }` — signal flows to `postCompletion` normally.
2. Returns `{ action: 'accept_with_handoff' }` — `writeHandoffs` is called with correct paths.
3. Returns `{ action: 'reject_and_retry' }` — node transitions to `retrying`, `scheduleNode` called.
4. Returns `{ action: 'reject_and_branch' }` — `handleExplicitBranch` called with target.

**`onPurposeGenerate`:**
5. Returns `{ append: '...' }` — appended to base purpose.
6. Returns `{ replace: '...' }` — replaces base purpose.
7. Returns `{ prepend: '...', variables: { KEY: 'val' } }` — prepended and `{{KEY}}` replaced.

**`onEvaluateReadiness`:**
8. Returns `{ ready: true }` — node transitions to `deps_met`.
9. Returns `{ ready: false, retryAfter: 5 }` — node stays pending, `setTimeout` called.

**`onResolveRouting`:**
10. Returns `{ selectedBranch: 'terminate' }` — `handleBranchDecisionByTarget` called.

**`onEvolutionaryContext`:**
11. Only called when `nodeDef.evolutionary_role` is set.
12. Result injected into `upstreamHandoffs.__evolutionary`.

---

### T25 — Unit tests: error handling paths

**File:** same as T24 or separate `__tests__/plugin-sdk-errors.test.ts`

**Tests:**
1. `onWorkflowStart` throws → `DagExecutor.start()` rejects with error.
2. `onSignalReceived` throws → node transitions to `failed` with `plugin_signal_error`.
3. `onPurposeGenerate` throws → node transitions to `failed` with `plugin_purpose_error`; static preset not used.
4. `onEvaluateReadiness` throws → node stays `pending` (not `failed`).
5. `onResolveRouting` throws → node transitions to `failed` with `plugin_routing_error`.
6. `onWorkflowComplete` throws → error is logged, workflow status unaffected.
7. `onEvaluationResult` throws → error is logged, workflow continues.
8. `declareTools` throws → workflow fails to start.

---

### T26 — Unit tests: TR Phase 6 hooks

**File:** `packages/server/src/modules/workflow/__tests__/plugin-sdk-tr-phase6.test.ts` (create)

**Tests:**

**`declareTools`:**
1. Required tool not found → workflow start fails.
2. Optional tool not found → warning logged, workflow continues.
3. `registryClient` null → declarations skipped with warning.
4. Version mismatch, required → fails; optional → warns.

**`onToolProposal`:**
5. Plugin not implemented → node fails with "workflow does not accept tool proposals".
6. Plugin returns `reject` → node fails with `rejectionReason`.
7. Plugin returns `accept` → `registryClient.register` called with proposal.
8. Plugin returns `modify` → modifications applied before registration.
9. `registryClient.register` throws → node fails with `tool_registration_failed`.

**`onToolRegression`:**
10. Stub present — invocation point is commented out, no functional effect (smoke test only).

---

### T27 — TypeScript build clean + integration smoke test

**Steps:**
1. Run `pnpm tsc --noEmit` from repo root. Zero errors expected.
2. Run existing smoke test: `node test-data/run-smoke.js`. Verify it completes (smoke-test workflow exercises the plugin system).
3. Check `plugin-log.jsonl` is written in the run directory.
4. If any failures: diagnose from TypeScript errors or smoke test output before marking complete.

---

## Execution Order

```
T01 → T02 → T03 → T04 (parallel with T03)
T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12 → T13 (sequential, all dag-executor)
T14 (review pass after T05–T13)
T15 → T16 → T17 → T18 → T19 (parallel across plugins after T03 done)
T20 → T21 → T22 (sequential, Phase B)
T23 → T24 → T25 → T26 (parallel after Phase A+B)
T27 (last)
```

Phase A dag-executor tasks (T05–T14) and plugin migrations (T15–T19) can proceed in parallel after T03 is done, since they touch different files.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `RegistryClient.register` signature mismatch for `caller: 'agent'` | Medium | Read registry module before T21; stub if needed |
| `evaluateReadyNodes` sync→async ripple effect | Medium | Search all call sites before T10 |
| Plugin files hold direct pool mutations via `onEvaluationResult` | Low | Plugins already hold private pool refs; EvaluationContext carries read data only |
| `WorkflowConfig.name` vs `.workflow` field naming inconsistency | Low | Check type definition before T05 |
| `onToolRegression` type included but never invocable | Accepted | By design; documented in stub |
