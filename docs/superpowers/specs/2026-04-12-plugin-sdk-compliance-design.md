# Plugin SDK Compliance Refactor — Design Spec

**Date:** 2026-04-12
**Status:** Approved for implementation
**Design doc:** `docs/design/plugin-sdk.md`
**Affected files:** `packages/server/src/modules/workflow/sdk.ts`, `packages/server/src/modules/workflow/dag-executor.ts`, `workflows/*/plugin.ts` (×5)

---

## 1. Problem Statement

The current `WorkflowPlugin` interface in `sdk.ts` uses flat parameter signatures that diverge from the rich context-object signatures specified in `docs/design/plugin-sdk.md`. This drift means:

- Plugins cannot access `PlatformServices` (registry client, value store, logger, run directory) from within hook implementations.
- Hook results (e.g. `SignalOverride`) are weaker than the design-doc types (`SignalDecision`), losing `handoffs` and `reject_and_branch` semantics.
- `onEvolutionaryContext` is defined in the interface but never invoked by `dag-executor.ts`.
- Three TR Phase 6 hooks (`declareTools`, `onToolProposal`, `onToolRegression`) are absent.
- Error handling per-hook deviates from the §9 table.

This refactor closes all of these gaps.

---

## 2. Scope

### In scope
- Rewrite `sdk.ts` with the design-doc types.
- Refactor all 9 hook invocations in `dag-executor.ts`.
- Migrate all 5 workflow plugins.
- Add `onEvolutionaryContext` invocation.
- Add stubs for the 3 TR Phase 6 hooks with invocation points.
- Implement per-hook error handling per §9.
- Unit tests for new types, context construction, hook wiring, error paths.

### Out of scope
- Regression testing infrastructure (deferred post-MVP).
- Plugin marketplace / versioning.
- Agent test runner beyond the stub.

---

## 3. New Types: `PlatformServices`

```typescript
export interface PlatformServices {
  registryClient: RegistryClient | null;
  valueStore: ValueStore | null;
  logger: PlatformLogger;
  runDirectory: string;
}

export interface PlatformLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
```

`PlatformServices` is constructed by `DagExecutor` and passed into every hook context. `registryClient` and `valueStore` are `null` when not initialised (preserving backward compat). `logger` wraps `console` and writes structured entries to `<runDir>/plugin-log.jsonl`.

---

## 4. Context and Result Types (full spec)

### 4.1 Lifecycle contexts

```typescript
interface WorkflowStartContext {
  runId: string;
  workflowName: string;
  workflowVersion: string;
  workflowConfig: Record<string, unknown>;
  runDirectory: string;
  platform: PlatformServices;
}

interface WorkflowResumeContext extends WorkflowStartContext {
  snapshotTimestamp: string;
  pendingNodes: string[];
  completedNodes: string[];
}

interface WorkflowCompleteContext extends WorkflowStartContext {
  status: 'success' | 'failure' | 'aborted';
  duration_seconds: number;
  nodesCompleted: number;
  nodesFailed: number;
  finalFindings: Finding[];
}
```

`Finding` is `{ id: string; content: string }` (matches existing finding callback signature).

### 4.2 Signal handling

```typescript
interface SignalContext {
  runId: string;
  signal: SignalFile;
  nodeName: string;
  scope: string | null;
  upstreamHandoffs: Record<string, unknown>;
  platform: PlatformServices;
}

interface SignalDecision {
  action: 'accept' | 'accept_with_handoff' | 'reject_and_retry' | 'reject_and_branch';
  handoffs?: HandoffFile[];
  retryReason?: string;
  branch?: { target: string; state: Record<string, unknown> };
}

interface HandoffFile {
  path: string;   // relative to runDirectory
  content: string;
}

interface EvaluationContext {
  runId: string;
  evaluatorNode: string;
  scope: string | null;
  candidateId: string;
  fitness: number;
  verdict: 'confirmed' | 'falsified' | 'inconclusive';
  evidence: Record<string, unknown>;
  platform: PlatformServices;
}
```

`upstreamHandoffs` is built from `node.signal?.outputs ?? {}` of immediate upstream nodes (already available in DagNode graph).

### 4.3 Scheduling

```typescript
interface ReadinessContext {
  runId: string;
  nodeName: string;
  scope: string | null;
  dependenciesCompleted: string[];
  platform: PlatformServices;
}

interface ReadinessDecision {
  ready: boolean;
  reason?: string;
  retryAfter?: number;
}

interface RoutingContext {
  runId: string;
  sourceNode: string;
  scope: string | null;
  decision: SignalFile['decision'];
  candidateBranches: string[];
  platform: PlatformServices;
}

interface RoutingDecision {
  selectedBranch: string;
  state?: Record<string, unknown>;
}
```

`onEvaluateReadiness` changes from sync to `Promise<ReadinessDecision>`. This is a breaking change for all callers; all current callers (`dag-executor.ts`) are updated simultaneously.

### 4.4 Purpose generation

```typescript
interface PurposeContext {
  runId: string;
  nodeName: string;
  scope: string | null;
  basePreset: string;
  upstreamHandoffs: Record<string, unknown>;
  attemptNumber: number;
  platform: PlatformServices;
}

interface PurposeEnrichment {
  prepend?: string;
  append?: string;
  replace?: string;
  variables?: Record<string, string>;
}

interface EvolutionaryContextRequest {
  runId: string;
  nodeName: string;
  role: 'generator' | 'evaluator' | 'selector';
  scope: string | null;
  poolSnapshot: PoolSnapshot;
  platform: PlatformServices;
}

interface EvolutionaryContextResult {
  positiveExamples: PoolCandidate[];
  negativeExamples: PoolCandidate[];
  ancestors: PoolCandidate[];
  customContext: Record<string, unknown>;
}

type PoolSnapshot = ReturnType<EvolutionaryPool['snapshot']>;
```

`EvolutionaryPool` gains a `snapshot()` method returning a serialisable view of current candidates.

### 4.5 TR Phase 6 types

```typescript
interface ToolDeclaration {
  name: string;
  version: number | 'latest';
  required: boolean;
  reason?: string;
}

interface ToolProposalContext {
  runId: string;
  proposingNode: string;
  scope: string | null;
  proposal: {
    name: string;
    description: string;
    manifest: ToolManifest;
    implementationSource: string;
    testsSource: string;
    rationale: string;
  };
  platform: PlatformServices;
}

interface ToolProposalResult {
  decision: 'accept' | 'reject' | 'modify';
  modifications?: {
    manifest?: Partial<ToolManifest>;
    implementationSource?: string;
    testsSource?: string;
  };
  rejectionReason?: string;
  registeredVersion?: number;
}

interface ToolRegressionContext {
  runId: string;
  newTool: { name: string; version: number };
  affectedTool: { name: string; version: number };
  failedTest: string;
  testOutput: string;
  platform: PlatformServices;
}

interface ToolRegressionResult {
  action: 'rollback_new' | 'accept_regression' | 'request_human_review';
  rationale?: string;
}
```

`ToolManifest` is imported from the registry module (already defined at `packages/server/src/modules/registry/`).

---

## 5. Updated `WorkflowPlugin` Interface

```typescript
export interface WorkflowPlugin {
  readonly name: string;
  readonly version?: string;

  // Lifecycle
  onWorkflowStart?(context: WorkflowStartContext): Promise<void>;
  onWorkflowResume?(context: WorkflowResumeContext): Promise<void>;
  onWorkflowComplete?(context: WorkflowCompleteContext): Promise<void>;

  // Signal handling
  onSignalReceived?(context: SignalContext): Promise<SignalDecision>;
  onEvaluationResult?(context: EvaluationContext): Promise<void>;

  // Scheduling
  onEvaluateReadiness?(context: ReadinessContext): Promise<ReadinessDecision>;
  onResolveRouting?(context: RoutingContext): Promise<RoutingDecision>;

  // Purpose generation
  onPurposeGenerate?(context: PurposeContext): Promise<PurposeEnrichment>;
  onEvolutionaryContext?(context: EvolutionaryContextRequest): Promise<EvolutionaryContextResult>;

  // TR Phase 6
  declareTools?(context: WorkflowStartContext): Promise<ToolDeclaration[]>;
  onToolProposal?(context: ToolProposalContext): Promise<ToolProposalResult>;
  onToolRegression?(context: ToolRegressionContext): Promise<ToolRegressionResult>;
}
```

Old types (`SignalOverride`, `RoutingResult`, `PurposeContext` flat, `EvolutionaryContext` old, `WorkflowSummary`, `DagNodeState`) are deleted from `sdk.ts`. `WorkflowSummary` moves to `dag-executor.ts` (it is an executor-internal type).

---

## 6. `dag-executor.ts` Hook Invocation Changes

### 6.1 `PlatformServices` construction

`DagExecutor` gains a private helper:

```typescript
private buildPlatformServices(): PlatformServices {
  return {
    registryClient: this.registryClient,
    valueStore: this.valueStore,
    logger: this.buildLogger(),
    runDirectory: path.join(this.workspacePath, '.plurics', 'runs', this.runId),
  };
}
```

Called once per hook invocation (cheap; no caching needed).

### 6.2 Hook invocation mapping

| Hook | Old call site | New call site |
|---|---|---|
| `onWorkflowStart` | `plugin.onWorkflowStart(workspacePath, config)` | `plugin.onWorkflowStart(startCtx)` |
| `onWorkflowResume` | `plugin.onWorkflowResume(workspacePath, config, completedNodes[])` | `plugin.onWorkflowResume(resumeCtx)` |
| `onWorkflowComplete` | `plugin.onWorkflowComplete(workspacePath, summary)` | `plugin.onWorkflowComplete(completeCtx)` |
| `onSignalReceived` | returns `SignalOverride \| null` → mutates signal in place | returns `SignalDecision` → executor applies action |
| `onEvaluationResult` | `(nodeName, signal, pool, workspacePath)` | `(EvaluationContext)` |
| `onEvaluateReadiness` | sync `boolean \| null` | `async Promise<ReadinessDecision>` |
| `onResolveRouting` | `(nodeName, signal, branchRules, workspacePath)` | `(RoutingContext)` |
| `onPurposeGenerate` | returns `string` | returns `PurposeEnrichment` |
| `onEvolutionaryContext` | **never invoked** | invoked for nodes with `evolutionary_role` |
| `declareTools` | **absent** | invoked before `onWorkflowStart` |
| `onToolProposal` | **absent** | invoked when signal contains `tool_proposal` |
| `onToolRegression` | **absent** | stub invocation point (regression engine deferred) |

### 6.3 `onSignalReceived` action dispatch

```typescript
const decision = await this.plugin.onSignalReceived(ctx);
switch (decision.action) {
  case 'accept':
    break; // continue normal flow
  case 'accept_with_handoff':
    await this.writeHandoffs(decision.handoffs ?? []);
    break;
  case 'reject_and_retry':
    node.retryCount++;
    this.transition(node.name, 'retrying');
    await this.scheduleNode(node, decision.retryReason);
    return; // skip postCompletion
  case 'reject_and_branch':
    await this.handleExplicitBranch(node, decision.branch!);
    return;
}
```

### 6.4 `onPurposeGenerate` enrichment application

```typescript
const enrichment = await this.plugin.onPurposeGenerate(ctx);
if (enrichment.replace) {
  purpose = enrichment.replace;
} else {
  if (enrichment.prepend) purpose = enrichment.prepend + '\n' + purpose;
  if (enrichment.append) purpose = purpose + '\n' + enrichment.append;
  if (enrichment.variables) purpose = applyVariables(purpose, enrichment.variables);
}
```

### 6.5 `onEvolutionaryContext` invocation point

In `buildPurpose`, before `onPurposeGenerate`:

```typescript
const nodeDef = this.workflowConfig.nodes[node.name];
if (nodeDef?.evolutionary_role && this.plugin?.onEvolutionaryContext) {
  const evoCtx: EvolutionaryContextRequest = {
    runId: this.runId,
    nodeName: node.name,
    role: nodeDef.evolutionary_role,
    scope: node.scope,
    poolSnapshot: this.pool.snapshot(),
    platform: this.buildPlatformServices(),
  };
  const evoResult = await this.plugin.onEvolutionaryContext(evoCtx);
  // merge into upstreamHandoffs so onPurposeGenerate can see it
  upstreamHandoffs.__evolutionary = evoResult;
}
```

---

## 7. Error Handling Matrix

Implemented in `dag-executor.ts` per the §9 table. Each hook invocation is wrapped in a try/catch with the specific behavior below:

| Hook | On exception |
|---|---|
| `declareTools` | `throw` — workflow fails to start |
| `onWorkflowStart` | `throw` — workflow fails to start |
| `onWorkflowResume` | `throw` — resume fails; snapshot untouched |
| `onWorkflowComplete` | `logger.error` + swallow |
| `onSignalReceived` | node transitions to `failed` with `plugin_signal_error` |
| `onEvaluationResult` | `logger.error` + swallow; pool may be inconsistent |
| `onEvaluateReadiness` | node stays `pending`; re-evaluated on next state change |
| `onResolveRouting` | node transitions to `failed` with `plugin_routing_error` |
| `onPurposeGenerate` | node transitions to `failed` with `plugin_purpose_error`; no fallback to static preset |
| `onEvolutionaryContext` | same as `onPurposeGenerate` |
| `onToolProposal` | proposing node receives failure signal with error as rejection reason |
| `onToolRegression` | new tool registration rolled back |

---

## 8. TR Phase 6 Hooks — Detailed Semantics

### 8.1 `declareTools`

Called in `DagExecutor.start()` after plugin load, before `onWorkflowStart`. Platform iterates declarations, calls `registryClient.lookup(name, version)` for each, and:
- Found at version → no-op.
- Found at different version, `required: true` → throw `PluginValidationError`.
- Found at different version, `required: false` → `logger.warn`.
- Not found, `required: true` → throw `PluginValidationError`.
- Not found, `required: false` → `logger.warn`.

If `registryClient` is null (registry disabled), declarations are logged and skipped.

### 8.2 `onToolProposal`

Signal detection: if `signal.outputs?.tool_proposal` is defined, the executor extracts it and calls `plugin.onToolProposal(ctx)`.

On `accept` or `modify`: platform calls `registryClient.register(proposal, { caller: 'agent' })`. On registration failure, node receives failure signal. On success, `registeredVersion` is set in the result and logged.

On `reject`: node receives failure signal with `rejectionReason`.

If `plugin.onToolProposal` is not implemented: node receives failure signal with message "workflow does not accept tool proposals".

If `registryClient` is null: node receives failure signal with message "registry not available".

### 8.3 `onToolRegression`

Invocation point exists in `DagExecutor` (inside the `declareTools` validation path, called if `registryClient` emits a regression event). The regression testing engine that would emit these events is deferred post-MVP. The stub logs `[plugin-sdk] onToolRegression invocation point reached (regression engine not yet active)` and returns without calling the hook.

---

## 9. Plugin Migration Pattern

Each of the 5 plugins (`research-swarm`, `theorem-prover-mini`, `math-discovery`, `sequence-explorer`, `smoke-test`) is migrated with this mechanical pattern:

**`onWorkflowStart(workspacePath, config)` → `onWorkflowStart(ctx)`**
- Replace `workspacePath` → `ctx.runDirectory` (note: old was workspace root, new is run-specific directory; also expose `ctx.platform.runDirectory` = `ctx.runDirectory`)
- Replace `config` → `ctx.workflowConfig`

**`onSignalReceived(nodeName, signal, workspacePath)` → `onSignalReceived(ctx)`**
- Replace params → `ctx.nodeName`, `ctx.signal`, `ctx.platform.runDirectory`
- Replace `return { status, decision }` (SignalOverride) → `return { action: 'accept' }` or appropriate `SignalDecision`

**`onPurposeGenerate(nodeName, basePurpose, oldCtx)` → `onPurposeGenerate(ctx)`**
- Replace: `nodeName` → `ctx.nodeName`, `basePurpose` → `ctx.basePreset`
- Old `oldCtx.scope` → `ctx.scope`, `oldCtx.retryCount` → `ctx.attemptNumber`, `oldCtx.workspacePath` → `ctx.platform.runDirectory`
- Return type changes from `string` to `PurposeEnrichment`: wrap existing return value in `{ append: existingString }` or `{ replace: existingString }` as appropriate.

**`onEvaluateReadiness(nodeName, allNodes)` → `onEvaluateReadiness(ctx)`**
- Replace sync return `boolean | null` → async `Promise<ReadinessDecision>`
- `true` → `{ ready: true }`, `false` → `{ ready: false }`, `null` (default) → `{ ready: true }` (if hook was returning null the engine used default — but now hook is only called when plugin implements it)

**`onWorkflowResume(workspacePath, config, completedNodes[])` → `onWorkflowResume(ctx)`**
- Replace params, reconstruct `completedNodes` from `ctx.completedNodes` (now string[] of names, not objects with signals)
- If plugins need signal data for completed nodes, they must read from `ctx.platform.runDirectory`

**`onResolveRouting(nodeName, signal, branchRules, workspacePath)` → `onResolveRouting(ctx)`**
- `nodeName` → `ctx.sourceNode`, `signal` → available via `ctx.decision`, `branchRules` → `ctx.candidateBranches` (string[] of goto targets)
- Return `RoutingDecision` instead of `RoutingResult`

**`onEvaluationResult(nodeName, signal, pool, workspacePath)` → `onEvaluationResult(ctx)`**
- Direct pool access removed; pool mutations go through `ctx.platform.valueStore` or the plugin's own private pool reference
- Note: `math-discovery` and `theorem-prover-mini` hold pool reference internally — keep that pattern

**`onWorkflowComplete(workspacePath, summary)` → `onWorkflowComplete(ctx)`**
- `summary` fields mapped: `runId` → `ctx.runId`, `totalNodes`/`completed`/`failed` → `ctx.nodesCompleted`/`ctx.nodesFailed`, `durationSeconds` → `ctx.duration_seconds`

---

## 10. Constraints and Decisions

**No backward compat shim.** All 5 plugins and all invocation sites are updated in the same PR. There is no intermediate adapter layer. This is feasible because the plugin surface is not public API.

**`workspacePath` vs `runDirectory`.** Old hooks passed `workspacePath` (the workspace root). New hooks pass `runDirectory` (the per-run subdirectory). Plugins that need the workspace root access it via `path.resolve(ctx.runDirectory, '../../../..')` or via `ctx.workflowConfig` if the path is stored there. All 5 plugins are audited to confirm they only write inside the run directory (they do).

**`onEvaluateReadiness` sync → async.** This is necessary to allow plugins to check external conditions. The existing plugins return sync values; they are wrapped in `Promise.resolve()` trivially.

**Pool snapshot.** `EvolutionaryPool.snapshot()` is a new method returning a deep copy of current candidates. It is cheap (pools are small). Plugins that previously received the live `pool` object now receive a snapshot for reads, and write back through `onEvaluationResult`.

**`ToolManifest` import.** Imported from `../registry/types.js` (to be verified; fallback is `Record<string, unknown>` if the type is not yet exported).
